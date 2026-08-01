"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityLogService = void 0;
const logger_1 = __importDefault(require("../monitoring/logger"));
const prisma_1 = require("../lib/prisma");
const browserDetection_1 = require("../utils/browserDetection");
const ipGeolocation_1 = require("../utils/ipGeolocation");
class SecurityLogService {
    static async logEvent(params) {
        try {
            let ipAddress = params.ip_address;
            let location = params.location;
            if (ipAddress && ipAddress !== "unknown" && ipAddress !== "127.0.0.1" && ipAddress !== "::1") {
                if (!location) {
                    location = await (0, ipGeolocation_1.getLocationFromIp)(ipAddress);
                }
            }
            await prisma_1.prisma.securityLog.create({
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
        }
        catch (error) {
            logger_1.default.error("Error logging security event:", error);
        }
    }
    static async getSecurityLogs(userId, filters = {}) {
        try {
            const { event_type, status, from_date, to_date, limit = 50, offset = 0, } = filters;
            const where = { user_id: userId };
            if (event_type) {
                where.event_type = event_type;
            }
            if (status) {
                where.status = status;
            }
            if (from_date || to_date) {
                where.created_at = {};
                if (from_date)
                    where.created_at.gte = from_date;
                if (to_date)
                    where.created_at.lte = to_date;
            }
            const [logs, total] = await Promise.all([
                prisma_1.prisma.securityLog.findMany({
                    where,
                    orderBy: { created_at: "desc" },
                    take: limit,
                    skip: offset,
                }),
                prisma_1.prisma.securityLog.count({ where }),
            ]);
            const formattedLogs = logs.map((log) => ({
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
        }
        catch (error) {
            logger_1.default.error("Error fetching security logs:", error);
            throw new Error("Failed to fetch security logs");
        }
    }
    static async getSecurityLogStats(userId) {
        try {
            const totalLogs = await prisma_1.prisma.securityLog.count({ where: { user_id: userId } });
            const failedLogins = await prisma_1.prisma.securityLog.count({
                where: { user_id: userId, event_type: "login", status: "failed" },
            });
            const successfulLogins = await prisma_1.prisma.securityLog.count({
                where: { user_id: userId, event_type: "login", status: "success" },
            });
            const passwordChanges = await prisma_1.prisma.securityLog.count({
                where: { user_id: userId, event_type: "password_change" },
            });
            const emailChanges = await prisma_1.prisma.securityLog.count({
                where: { user_id: userId, event_type: "email_change" },
            });
            const twoFactorChanges = await prisma_1.prisma.securityLog.count({
                where: {
                    user_id: userId,
                    event_type: { in: ["2fa_enable", "2fa_disable"] },
                },
            });
            const sessionsTerminated = await prisma_1.prisma.securityLog.count({
                where: { user_id: userId, event_type: "session_terminated" },
            });
            const recentActivity = await prisma_1.prisma.securityLog.findMany({
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
                recent_activity: recentActivity.map((log) => ({
                    id: log.id,
                    event_type: log.event_type,
                    description: log.description,
                    status: log.status,
                    created_at: log.created_at,
                    location: log.location,
                })),
            };
        }
        catch (error) {
            logger_1.default.error("Error fetching security log stats:", error);
            throw new Error("Failed to fetch security log stats");
        }
    }
    static async recordLoginAttempt(userId, userAgent, ipAddress, status, errorCode) {
        const browserInfo = (0, browserDetection_1.detectBrowser)(userAgent);
        const deviceInfo = (0, browserDetection_1.detectDeviceType)(userAgent);
        const location = await (0, ipGeolocation_1.getLocationFromIp)(ipAddress);
        await prisma_1.prisma.loginHistory.create({
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
        await prisma_1.prisma.securityLog.create({
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
    static async recordPasswordChange(userId, ipAddress, userAgent) {
        const browserInfo = (0, browserDetection_1.detectBrowser)(userAgent);
        const deviceInfo = (0, browserDetection_1.detectDeviceType)(userAgent);
        await prisma_1.prisma.securityLog.create({
            data: {
                user_id: userId,
                event_type: "password_change",
                description: "Password was changed successfully",
                ip_address: ipAddress,
                user_agent: userAgent,
                device_info: userAgent,
                browser: browserInfo.browser,
                device_type: deviceInfo.deviceType,
                location: await (0, ipGeolocation_1.getLocationFromIp)(ipAddress),
                status: "success",
            },
        });
    }
    static async recordEmailChange(userId, ipAddress, userAgent) {
        const browserInfo = (0, browserDetection_1.detectBrowser)(userAgent);
        const deviceInfo = (0, browserDetection_1.detectDeviceType)(userAgent);
        await prisma_1.prisma.securityLog.create({
            data: {
                user_id: userId,
                event_type: "email_change",
                description: "Email address was changed",
                ip_address: ipAddress,
                user_agent: userAgent,
                device_info: userAgent,
                browser: browserInfo.browser,
                device_type: deviceInfo.deviceType,
                location: await (0, ipGeolocation_1.getLocationFromIp)(ipAddress),
                status: "success",
            },
        });
    }
    static async record2FAEvent(userId, ipAddress, userAgent, action) {
        const browserInfo = (0, browserDetection_1.detectBrowser)(userAgent);
        const deviceInfo = (0, browserDetection_1.detectDeviceType)(userAgent);
        await prisma_1.prisma.securityLog.create({
            data: {
                user_id: userId,
                event_type: action === "enable" ? "2fa_enable" : "2fa_disable",
                description: action === "enable" ? "Two-factor authentication was enabled" : "Two-factor authentication was disabled",
                ip_address: ipAddress,
                user_agent: userAgent,
                device_info: userAgent,
                browser: browserInfo.browser,
                device_type: deviceInfo.deviceType,
                location: await (0, ipGeolocation_1.getLocationFromIp)(ipAddress),
                status: "success",
            },
        });
    }
    static async recordSessionTerminated(userId, ipAddress, userAgent, sessionId) {
        const browserInfo = (0, browserDetection_1.detectBrowser)(userAgent);
        const deviceInfo = (0, browserDetection_1.detectDeviceType)(userAgent);
        await prisma_1.prisma.securityLog.create({
            data: {
                user_id: userId,
                event_type: "session_terminated",
                description: sessionId ? `Session ${sessionId} was terminated` : "All other sessions were terminated",
                ip_address: ipAddress,
                user_agent: userAgent,
                device_info: userAgent,
                browser: browserInfo.browser,
                device_type: deviceInfo.deviceType,
                location: await (0, ipGeolocation_1.getLocationFromIp)(ipAddress),
                status: "success",
            },
        });
    }
}
exports.SecurityLogService = SecurityLogService;
