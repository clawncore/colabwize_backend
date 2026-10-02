import logger from "../monitoring/logger";
import { prisma } from "../lib/prisma";
import { detectBrowser, detectDeviceType, detectOS, getDeviceLabel, formatIpAddress } from "../utils/browserDetection";
import { getLocationFromIp } from "../utils/ipGeolocation";
import { EmailService } from "./emailService";
import { SecretsService } from "../services/secrets-service";

export class SecurityService {
  /**
   * Resolves which of the given session rows belongs to the device making the
   * current request, returning its index (or -1 if none can be identified).
   *
   * `is_current` alone is not usable for this: it records the most recent login,
   * which may have happened on a different device, so relying on it can select
   * the wrong row. The request IP is the better signal, but several sessions can
   * legitimately share one IP (household or office NAT), so the user agent is
   * required to disambiguate. `is_current` is consulted only as a last resort.
   *
   * Returning a single index guarantees a caller can never end up with two rows
   * both flagged as the current device.
   */
  private static resolveOwnSessionIndex(sessions: any[], req: any): number {
    const xForwardedFor = req?.headers?.["x-forwarded-for"] as string | undefined;
    const directIp = req?.ip || req?.connection?.remoteAddress || "unknown";
    const currentIp = formatIpAddress(xForwardedFor || null, directIp);
    const requestUserAgent = (req?.headers?.["user-agent"] as string) || "";

    if (!currentIp || currentIp === "Unknown") return -1;

    const sameIp = sessions.filter(
      (session) => !!session.ip_address && session.ip_address === currentIp,
    );
    if (sameIp.length === 0) return -1;

    // Unambiguous when only one session shares this IP.
    if (sameIp.length === 1) return sessions.indexOf(sameIp[0]);

    // Several sessions share the IP - disambiguate on the user agent.
    if (requestUserAgent) {
      const byAgent = sameIp.filter(
        (session) => !!session.device_info && session.device_info === requestUserAgent,
      );
      if (byAgent.length > 0) return sessions.indexOf(byAgent[0]);
    }

    // Same IP, no usable agent match - fall back to the most recent login.
    return sessions.indexOf(
      sameIp.find((session) => session.is_current === true) ?? sameIp[0],
    );
  }

  /**
   * Returns every session that has not been terminated.
   *
   * "Active" means `ended_at IS NULL` - the same definition already used by the
   * admin force-logout endpoint (see src/admin/api/remote.ts). It is NOT
   * `is_current`, which only ever flags the single most recent login and
   * therefore could only ever return one row.
   */
  static async getActiveSessions(userId: string, req: any) {
    try {
      const userSessions = await prisma.userSession.findMany({
        where: {
          user_id: userId,
          ended_at: null,
        },
        orderBy: [
          { is_current: "desc" },
          { last_active: "desc" },
        ],
      });

      const currentIndex = SecurityService.resolveOwnSessionIndex(userSessions, req);

      const sessions = userSessions.map((session: any, index: number) => {
        const browserInfo = detectBrowser(session.device_info || "");
        const deviceInfo = detectDeviceType(session.device_info || "");

        return {
          id: session.id,
          session_id: session.session_id,
          device: deviceInfo.deviceType,
          device_label: getDeviceLabel(session.device_info || ""),
          browser: browserInfo.browser,
          browser_version: browserInfo.version,
          location: session.location || "Unknown",
          ip_address: session.ip_address || "Unknown",
          lastActive: session.last_active || session.started_at,
          current: index === currentIndex,
          started_at: session.started_at,
        };
      });

      return sessions;
    } catch (error) {
      logger.error("Error fetching active sessions:", error);
      throw new Error("Failed to fetch active sessions");
    }
  }

  static async getAllSessions(userId: string) {
    try {
      const userSessions = await prisma.userSession.findMany({
        where: {
          user_id: userId,
        },
        orderBy: {
          last_active: "desc",
        },
      });

      const sessions = await Promise.all(
        userSessions.map(async (session: any) => {
          const browserInfo = detectBrowser(session.device_info || "");
          const deviceInfo = detectDeviceType(session.device_info || "");

          return {
            id: session.id,
            session_id: session.session_id,
            device: deviceInfo.deviceType,
            device_label: getDeviceLabel(session.device_info || ""),
            browser: browserInfo.browser,
            browser_version: browserInfo.version,
            location: session.location || "Unknown",
            ip_address: session.ip_address || "Unknown",
            lastActive: session.last_active || session.started_at,
            current: session.is_current,
            started_at: session.started_at,
          };
        }),
      );

      return sessions;
    } catch (error) {
      logger.error("Error fetching all sessions:", error);
      throw new Error("Failed to fetch sessions");
    }
  }

  static async signOutSession(userId: string, sessionId: string) {
    try {
      const session = await prisma.userSession.findFirst({
        where: {
          id: sessionId,
          user_id: userId,
        },
      });

      if (!session) {
        throw new Error("Session not found");
      }

      if (session.ended_at) {
        throw new Error("Session is already signed out");
      }

      // Note: UserSession has no `expires_at` column - writing one makes Prisma
      // reject the update at runtime. Termination is recorded via `ended_at`,
      // consistent with the admin revoke-session endpoint.
      await prisma.userSession.update({
        where: { id: sessionId },
        data: {
          is_current: false,
          ended_at: new Date(),
        },
      });

      await prisma.securityLog.create({
        data: {
          user_id: userId,
          event_type: "session_terminated",
          description: "Session was manually terminated by user",
          ip_address: session.ip_address || null,
          device_info: session.device_info || null,
          browser: session.browser || null,
          device_type: session.device_type || null,
          location: session.location || null,
          status: "success",
        },
      });

      await SecurityService.sendSecurityAlerts(userId, "session_terminated", session.ip_address || "", session.device_info || "", session.location || "Unknown");

      return { success: true, message: "Session signed out successfully" };
    } catch (error) {
      logger.error("Error signing out session:", error);
      throw error;
    }
  }

  static async signOutAllOtherSessions(userId: string, req?: any) {
    try {
      // Terminate every live session except the one making this request.
      //
      // The previous filter (`is_current: false`) matched only sessions that had
      // already been superseded, so the call was effectively a no-op. Active now
      // means `ended_at IS NULL`, and the caller's own row is excluded by
      // `session_id` so "sign out other devices" never signs the user out of
      // the device they are currently using.
      const liveSessions = await prisma.userSession.findMany({
        where: { user_id: userId, ended_at: null },
        orderBy: [
          { is_current: "desc" },
          { last_active: "desc" },
        ],
      });

      const ownIndex = SecurityService.resolveOwnSessionIndex(liveSessions, req);
      const ownSessionId =
        ownIndex >= 0 ? (liveSessions[ownIndex] as any).session_id : undefined;

      // If the caller's row cannot be identified, fall back to the stored
      // current session so at least one session survives the operation.
      const keepSessionId =
        ownSessionId ??
        (liveSessions.find((s: any) => s.is_current) as any)?.session_id;

      const result = await prisma.userSession.updateMany({
        where: {
          user_id: userId,
          ended_at: null,
          ...(keepSessionId ? { session_id: { not: keepSessionId } } : {}),
        },
        data: {
          is_current: false,
          ended_at: new Date(),
        },
      });

      await prisma.securityLog.create({
        data: {
          user_id: userId,
          event_type: "session_terminated",
          description: "All other sessions were terminated by user",
          status: "success",
        },
      });

      await SecurityService.sendSecurityAlerts(userId, "session_terminated", "", "", "Unknown");

      return {
        success: true,
        message: `Signed out ${result.count} other ${
          result.count === 1 ? "session" : "sessions"
        } successfully`,
      };
    } catch (error) {
      logger.error("Error signing out all other sessions:", error);
      throw new Error("Failed to sign out all other sessions");
    }
  }

  static async getLoginHistory(userId: string, limit = 20, offset = 0) {
    try {
      const loginHistory = await prisma.loginHistory.findMany({
        where: {
          user_id: userId,
        },
        orderBy: {
          created_at: "desc",
        },
        take: limit,
        skip: offset,
      });

      const formattedHistory = loginHistory.map((login: any) => ({
        id: login.id,
        date: login.created_at,
        device: getDeviceLabel(login.device_info || ""),
        browser: login.browser || "Unknown",
        device_type: login.device_type || "Desktop",
        ip: login.ip_address || "Unknown",
        location: login.location || "Unknown",
        status: login.status,
      }));

      return formattedHistory;
    } catch (error) {
      logger.error("Error fetching login history:", error);
      throw new Error("Failed to fetch login history");
    }
  }

  static async getPrivacySettings(userId: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          email_unusual_logins: true,
          notify_new_devices: true,
        },
      });

      if (!user) {
        throw new Error("User not found");
      }

      return {
        email_unusual_logins: user.email_unusual_logins ?? true,
        notify_new_devices: user.notify_new_devices ?? true,
      };
    } catch (error) {
      logger.error("Error fetching privacy settings:", error);
      throw new Error("Failed to fetch privacy settings");
    }
  }

  static async updatePrivacySettings(
    userId: string,
    settings: { email_unusual_logins?: boolean; notify_new_devices?: boolean },
  ) {
    try {
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          email_unusual_logins: settings.email_unusual_logins,
          notify_new_devices: settings.notify_new_devices,
        },
        select: {
          id: true,
          email_unusual_logins: true,
          notify_new_devices: true,
        },
      });

      return updatedUser;
    } catch (error) {
      logger.error("Error updating privacy settings:", error);
      throw new Error("Failed to update privacy settings");
    }
  }

  static async recordLoginAttempt(
    userId: string,
    ipAddress: string,
    userAgent: string,
    location: string,
    status: string,
    errorCode?: string,
  ) {
    try {
      const browserInfo = detectBrowser(userAgent);
      const deviceInfo = detectDeviceType(userAgent);

      // Send security alerts BEFORE recording login history.
      // isNewDevice() checks loginHistory for recent same-device logins —
      // if we record the login first, isNewDevice always returns false
      // and the new-device login alert is never sent.
      if (status === "success") {
        await SecurityService.sendSecurityAlerts(userId, "login", ipAddress, userAgent, location || "Unknown");
      } else if (status === "failed") {
        await SecurityService.sendSecurityAlerts(userId, "login_failed", ipAddress, userAgent, location || "Unknown");
      }

      await prisma.loginHistory.create({
        data: {
          user_id: userId,
          device_info: userAgent,
          browser: browserInfo.browser,
          device_type: deviceInfo.deviceType,
          ip_address: ipAddress,
          location: location || null,
          status,
          error_code: errorCode || null,
        },
      });

      await prisma.securityLog.create({
        data: {
          user_id: userId,
          event_type: "login",
          description: status === "success" ? "Successful login" : `Failed login attempt${errorCode ? " (" + errorCode + ")" : ""}`,
          ip_address: ipAddress,
          user_agent: userAgent,
          device_info: userAgent,
          browser: browserInfo.browser,
          device_type: deviceInfo.deviceType,
          location: location || null,
          status,
        },
      });
    } catch (error) {
      logger.error("Error recording login attempt:", error);
    }
  }

  static async getSecuritySettings(userId: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          email_verified: true,
          two_factor_enabled: true,
          email_unusual_logins: true,
          notify_new_devices: true,
          created_at: true,
        },
      });

      if (!user) {
        throw new Error("User not found");
      }

      return user;
    } catch (error) {
      logger.error("Error fetching security settings:", error);
      throw new Error("Failed to fetch security settings");
    }
  }

  static async sendSecurityAlerts(
    userId: string,
    eventType: string,
    ipAddress: string,
    userAgent: string,
    location: string,
  ) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          full_name: true,
          email_unusual_logins: true,
          notify_new_devices: true,
        },
      });

      if (!user || !user.email) return;

      const browserInfo = detectBrowser(userAgent);
      const deviceInfo = detectDeviceType(userAgent);
      const alertIp = formatIpAddress(null, ipAddress);

      if (eventType === "login" && user.notify_new_devices) {
        const isNew = await SecurityService.isNewDevice(userId, deviceInfo.deviceType, browserInfo.browser);
        if (isNew) {
          await EmailService.sendNewDeviceLoginEmail(
            user.email,
            user.full_name || "there",
            alertIp,
            location || "Unknown",
            deviceInfo.deviceType,
            browserInfo.browser,
          );
        }
      }

      if (eventType === "login_failed" && user.email_unusual_logins) {
        await EmailService.sendUnusualLoginAlertEmail(
          user.email,
          user.full_name || "there",
          alertIp,
          location || "Unknown",
          deviceInfo.deviceType,
          browserInfo.browser,
        );
      }
    } catch (error) {
      logger.error("Error sending security alert email:", error);
    }
  }

  static async isNewDevice(userId: string, deviceType: string, browser: string): Promise<boolean> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentLogins = await prisma.loginHistory.findMany({
        where: {
          user_id: userId,
          device_type: deviceType,
          browser,
          status: "success",
          created_at: { gte: sevenDaysAgo },
        },
        take: 1,
      });

      return recentLogins.length === 0;
    } catch {
      return true;
    }
  }
}