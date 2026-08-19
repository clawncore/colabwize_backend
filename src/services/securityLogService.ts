import logger from "../monitoring/logger";
import { prisma } from "../lib/prisma";
import { detectBrowser, detectDeviceType, formatIpAddress } from "../utils/browserDetection";
import { getLocationFromIp } from "../utils/ipGeolocation";

export interface SecurityLogEntry {
  id: string;
  event_type: string;
  description: string;
  ip_address: string | null;
  user_agent: string | null;
  device_info: string | null;
  browser: string | null;
  device_type: string | null;
  location: string | null;
  status: string;
  metadata: any | null;
  created_at: Date;
}

export interface SecurityLogFilters {
  event_type?: string;
  status?: string;
  from_date?: Date;
  to_date?: Date;
  limit?: number;
  offset?: number;
}

export class SecurityLogService {
  static async logEvent(params: {
    user_id: string;
    event_type: string;
    description: string;
    ip_address?: string;
    user_agent?: string;
    device_info?: string;
    browser?: string;
    device_type?: string;
    location?: string;
    status?: string;
    metadata?: any;
  }) {
    try {
      let ipAddress = params.ip_address;
      let location = params.location;

      if (ipAddress && ipAddress !== "unknown" && ipAddress !== "127.0.0.1" && ipAddress !== "::1") {
        if (!location) {
          location = await getLocationFromIp(ipAddress);
        }
      }

      await prisma.securityLog.create({
        data: {
          user_id: params.user_id,
          event_type: params.event_type,
          description: params.description,
          ip_address: ipAddress || null,
          user_agent: params.user_agent || null,
          device_info: params.device_info || null,
          browser: params.browser || null,
          device_type: params.device_type || null,
          location: location || null,
          status: params.status || "success",
          metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        },
      });
    } catch (error) {
      logger.error("Error logging security event:", error);
    }
  }

  static async getSecurityLogs(
    userId: string,
    filters: SecurityLogFilters = {},
  ): Promise<{ logs: SecurityLogEntry[]; total: number }> {
    try {
      const {
        event_type,
        status,
        from_date,
        to_date,
        limit = 50,
        offset = 0,
      } = filters;

      const where: any = { user_id: userId };

      if (event_type) {
        where.event_type = event_type;
      }
      if (status) {
        where.status = status;
      }
      if (from_date || to_date) {
        where.created_at = {};
        if (from_date) where.created_at.gte = from_date;
        if (to_date) where.created_at.lte = to_date;
      }

      const [logs, total] = await Promise.all([
        prisma.securityLog.findMany({
          where,
          orderBy: { created_at: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.securityLog.count({ where }),
      ]);

      const formattedLogs = logs.map((log: any) => ({
        id: log.id,
        event_type: log.event_type,
        description: log.description,
        ip_address: log.ip_address,
        user_agent: log.user_agent,
        device_info: log.device_info,
        browser: log.browser,
        device_type: log.device_type,
        location: log.location,
        status: log.status,
        metadata: log.metadata ? JSON.parse(log.metadata) : null,
        created_at: log.created_at,
      }));

      return { logs: formattedLogs, total };
    } catch (error) {
      logger.error("Error fetching security logs:", error);
      throw new Error("Failed to fetch security logs");
    }
  }

  static async getSecurityLogStats(userId: string) {
    try {
      const totalLogs = await prisma.securityLog.count({ where: { user_id: userId } });

      const failedLogins = await prisma.securityLog.count({
        where: { user_id: userId, event_type: "login", status: "failed" },
      });

      const successfulLogins = await prisma.securityLog.count({
        where: { user_id: userId, event_type: "login", status: "success" },
      });

      const passwordChanges = await prisma.securityLog.count({
        where: { user_id: userId, event_type: "password_change" },
      });

      const emailChanges = await prisma.securityLog.count({
        where: { user_id: userId, event_type: "email_change" },
      });

      const twoFactorChanges = await prisma.securityLog.count({
        where: {
          user_id: userId,
          event_type: { in: ["2fa_enable", "2fa_disable"] },
        },
      });

      const sessionsTerminated = await prisma.securityLog.count({
        where: { user_id: userId, event_type: "session_terminated" },
      });

      const recentActivity = await prisma.securityLog.findMany({
        where: { user_id: userId },
        orderBy: { created_at: "desc" },
        take: 10,
      });

      return {
        total_logs: totalLogs,
        failed_logins: failedLogins,
        successful_logins: successfulLogins,
        password_changes: passwordChanges,
        email_changes: emailChanges,
        two_factor_changes: twoFactorChanges,
        sessions_terminated: sessionsTerminated,
        recent_activity: recentActivity.map((log: any) => ({
          id: log.id,
          event_type: log.event_type,
          description: log.description,
          status: log.status,
          created_at: log.created_at,
          location: log.location,
        })),
      };
    } catch (error) {
      logger.error("Error fetching security log stats:", error);
      throw new Error("Failed to fetch security log stats");
    }
  }

  static async recordLoginAttempt(
    userId: string,
    userAgent: string,
    ipAddress: string,
    status: string,
    errorCode?: string,
  ) {
    const browserInfo = detectBrowser(userAgent);
    const deviceInfo = detectDeviceType(userAgent);
    const location = await getLocationFromIp(ipAddress);

    await prisma.loginHistory.create({
      data: {
        user_id: userId,
        device_info: userAgent,
        browser: browserInfo.browser,
        device_type: deviceInfo.deviceType,
        ip_address: ipAddress,
        location,
        status,
        error_code: errorCode || null,
      },
    });

    await prisma.securityLog.create({
      data: {
        user_id: userId,
        event_type: "login",
        description: status === "success" ? "Successful login" : `Failed login attempt${errorCode ? ` (${errorCode})` : ""}`,
        ip_address: ipAddress,
        user_agent: userAgent,
        device_info: userAgent,
        browser: browserInfo.browser,
        device_type: deviceInfo.deviceType,
        location,
        status,
      },
    });
  }

  static async recordPasswordChange(userId: string, ipAddress: string, userAgent: string) {
    const browserInfo = detectBrowser(userAgent);
    const deviceInfo = detectDeviceType(userAgent);

    await prisma.securityLog.create({
      data: {
        user_id: userId,
        event_type: "password_change",
        description: "Password was changed successfully",
        ip_address: ipAddress,
        user_agent: userAgent,
        device_info: userAgent,
        browser: browserInfo.browser,
        device_type: deviceInfo.deviceType,
        location: await getLocationFromIp(ipAddress),
        status: "success",
      },
    });
  }

  static async recordEmailChange(userId: string, ipAddress: string, userAgent: string) {
    const browserInfo = detectBrowser(userAgent);
    const deviceInfo = detectDeviceType(userAgent);

    await prisma.securityLog.create({
      data: {
        user_id: userId,
        event_type: "email_change",
        description: "Email address was changed",
        ip_address: ipAddress,
        user_agent: userAgent,
        device_info: userAgent,
        browser: browserInfo.browser,
        device_type: deviceInfo.deviceType,
        location: await getLocationFromIp(ipAddress),
        status: "success",
      },
    });
  }

  static async record2FAEvent(userId: string, ipAddress: string, userAgent: string, action: "enable" | "disable") {
    const browserInfo = detectBrowser(userAgent);
    const deviceInfo = detectDeviceType(userAgent);

    await prisma.securityLog.create({
      data: {
        user_id: userId,
        event_type: action === "enable" ? "2fa_enable" : "2fa_disable",
        description: action === "enable" ? "Two-factor authentication was enabled" : "Two-factor authentication was disabled",
        ip_address: ipAddress,
        user_agent: userAgent,
        device_info: userAgent,
        browser: browserInfo.browser,
        device_type: deviceInfo.deviceType,
        location: await getLocationFromIp(ipAddress),
        status: "success",
      },
    });
  }

  static async recordSessionTerminated(userId: string, ipAddress: string, userAgent: string, sessionId?: string) {
    const browserInfo = detectBrowser(userAgent);
    const deviceInfo = detectDeviceType(userAgent);

    await prisma.securityLog.create({
      data: {
        user_id: userId,
        event_type: "session_terminated",
        description: sessionId ? `Session ${sessionId} was terminated` : "All other sessions were terminated",
        ip_address: ipAddress,
        user_agent: userAgent,
        device_info: userAgent,
        browser: browserInfo.browser,
        device_type: deviceInfo.deviceType,
        location: await getLocationFromIp(ipAddress),
        status: "success",
      },
    });
  }
}