import logger from "../monitoring/logger";
import { prisma } from "../lib/prisma";
import { detectBrowser, detectDeviceType, detectOS, getDeviceLabel, formatIpAddress } from "../utils/browserDetection";
import { getLocationFromIp } from "../utils/ipGeolocation";
import { EmailService } from "./emailService";
import { SecretsService } from "../services/secrets-service";

export class SecurityService {
  static async getActiveSessions(userId: string, req: any) {
    try {
      const userSessions = await prisma.userSession.findMany({
        where: {
          user_id: userId,
          is_current: true,
        },
        orderBy: {
          last_active: "desc",
        },
      });

      const xForwardedFor = req.headers["x-forwarded-for"] as string | undefined;
      const directIp = req.ip || req.connection?.remoteAddress || "unknown";
      const currentIp = formatIpAddress(xForwardedFor || null, directIp);

      const sessions = await Promise.all(
        userSessions.map(async (session) => {
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
            ip_address: session.ip_address || currentIp,
            lastActive: session.last_active || session.started_at,
            current: true,
            started_at: session.started_at,
          };
        }),
      );

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
        userSessions.map(async (session) => {
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

      if (session.is_current) {
        throw new Error("Cannot sign out the current session");
      }

      await prisma.userSession.update({
        where: { id: sessionId },
        data: {
          is_current: false,
          ended_at: new Date(),
          expires_at: new Date(),
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

  static async signOutAllOtherSessions(userId: string) {
    try {
      await prisma.userSession.updateMany({
        where: {
          user_id: userId,
          is_current: false,
        },
        data: {
          is_current: false,
          ended_at: new Date(),
          expires_at: new Date(),
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

      return { success: true, message: "All other sessions signed out successfully" };
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

      const formattedHistory = loginHistory.map((login) => ({
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

      if (status === "success") {
        await SecurityService.sendSecurityAlerts(userId, "login", ipAddress, userAgent, location || "Unknown");
      } else if (status === "failed") {
        await SecurityService.sendSecurityAlerts(userId, "login_failed", ipAddress, userAgent, location || "Unknown");
      }
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