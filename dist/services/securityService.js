"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityService = void 0;
const logger_1 = __importDefault(require("../monitoring/logger"));
const prisma_1 = require("../lib/prisma");
const browserDetection_1 = require("../utils/browserDetection");
const emailService_1 = require("./emailService");
class SecurityService {
    static async getActiveSessions(userId, req) {
        try {
            const userSessions = await prisma_1.prisma.userSession.findMany({
                where: {
                    user_id: userId,
                    is_current: true,
                },
                orderBy: {
                    last_active: "desc",
                },
            });
            const xForwardedFor = req.headers["x-forwarded-for"];
            const directIp = req.ip || req.connection?.remoteAddress || "unknown";
            const currentIp = (0, browserDetection_1.formatIpAddress)(xForwardedFor || null, directIp);
            const sessions = await Promise.all(userSessions.map(async (session) => {
                const browserInfo = (0, browserDetection_1.detectBrowser)(session.device_info || "");
                const deviceInfo = (0, browserDetection_1.detectDeviceType)(session.device_info || "");
                return {
                    id: session.id,
                    session_id: session.session_id,
                    device: deviceInfo.deviceType,
                    device_label: (0, browserDetection_1.getDeviceLabel)(session.device_info || ""),
                    browser: browserInfo.browser,
                    browser_version: browserInfo.version,
                    location: session.location || "Unknown",
                    ip_address: session.ip_address || currentIp,
                    lastActive: session.last_active || session.started_at,
                    current: true,
                    started_at: session.started_at,
                };
            }));
            return sessions;
        }
        catch (error) {
            logger_1.default.error("Error fetching active sessions:", error);
            throw new Error("Failed to fetch active sessions");
        }
    }
    static async getAllSessions(userId) {
        try {
            const userSessions = await prisma_1.prisma.userSession.findMany({
                where: {
                    user_id: userId,
                },
                orderBy: {
                    last_active: "desc",
                },
            });
            const sessions = await Promise.all(userSessions.map(async (session) => {
                const browserInfo = (0, browserDetection_1.detectBrowser)(session.device_info || "");
                const deviceInfo = (0, browserDetection_1.detectDeviceType)(session.device_info || "");
                return {
                    id: session.id,
                    session_id: session.session_id,
                    device: deviceInfo.deviceType,
                    device_label: (0, browserDetection_1.getDeviceLabel)(session.device_info || ""),
                    browser: browserInfo.browser,
                    browser_version: browserInfo.version,
                    location: session.location || "Unknown",
                    ip_address: session.ip_address || "Unknown",
                    lastActive: session.last_active || session.started_at,
                    current: session.is_current,
                    started_at: session.started_at,
                };
            }));
            return sessions;
        }
        catch (error) {
            logger_1.default.error("Error fetching all sessions:", error);
            throw new Error("Failed to fetch sessions");
        }
    }
    static async signOutSession(userId, sessionId) {
        try {
            const session = await prisma_1.prisma.userSession.findFirst({
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
            await prisma_1.prisma.userSession.update({
                where: { id: sessionId },
                data: {
                    is_current: false,
                    ended_at: new Date(),
                    expires_at: new Date(),
                },
            });
            await prisma_1.prisma.securityLog.create({
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
        }
        catch (error) {
            logger_1.default.error("Error signing out session:", error);
            throw error;
        }
    }
    static async signOutAllOtherSessions(userId) {
        try {
            await prisma_1.prisma.userSession.updateMany({
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
            await prisma_1.prisma.securityLog.create({
                data: {
                    user_id: userId,
                    event_type: "session_terminated",
                    description: "All other sessions were terminated by user",
                    status: "success",
                },
            });
            await SecurityService.sendSecurityAlerts(userId, "session_terminated", "", "", "Unknown");
            return { success: true, message: "All other sessions signed out successfully" };
        }
        catch (error) {
            logger_1.default.error("Error signing out all other sessions:", error);
            throw new Error("Failed to sign out all other sessions");
        }
    }
    static async getLoginHistory(userId, limit = 20, offset = 0) {
        try {
            const loginHistory = await prisma_1.prisma.loginHistory.findMany({
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
                device: (0, browserDetection_1.getDeviceLabel)(login.device_info || ""),
                browser: login.browser || "Unknown",
                device_type: login.device_type || "Desktop",
                ip: login.ip_address || "Unknown",
                location: login.location || "Unknown",
                status: login.status,
            }));
            return formattedHistory;
        }
        catch (error) {
            logger_1.default.error("Error fetching login history:", error);
            throw new Error("Failed to fetch login history");
        }
    }
    static async getPrivacySettings(userId) {
        try {
            const user = await prisma_1.prisma.user.findUnique({
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
        }
        catch (error) {
            logger_1.default.error("Error fetching privacy settings:", error);
            throw new Error("Failed to fetch privacy settings");
        }
    }
    static async updatePrivacySettings(userId, settings) {
        try {
            const updatedUser = await prisma_1.prisma.user.update({
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
        }
        catch (error) {
            logger_1.default.error("Error updating privacy settings:", error);
            throw new Error("Failed to update privacy settings");
        }
    }
    static async recordLoginAttempt(userId, ipAddress, userAgent, location, status, errorCode) {
        try {
            const browserInfo = (0, browserDetection_1.detectBrowser)(userAgent);
            const deviceInfo = (0, browserDetection_1.detectDeviceType)(userAgent);
            await prisma_1.prisma.loginHistory.create({
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
            await prisma_1.prisma.securityLog.create({
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
            }
            else if (status === "failed") {
                await SecurityService.sendSecurityAlerts(userId, "login_failed", ipAddress, userAgent, location || "Unknown");
            }
        }
        catch (error) {
            logger_1.default.error("Error recording login attempt:", error);
        }
    }
    static async getSecuritySettings(userId) {
        try {
            const user = await prisma_1.prisma.user.findUnique({
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
        }
        catch (error) {
            logger_1.default.error("Error fetching security settings:", error);
            throw new Error("Failed to fetch security settings");
        }
    }
    static async sendSecurityAlerts(userId, eventType, ipAddress, userAgent, location) {
        try {
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    email: true,
                    full_name: true,
                    email_unusual_logins: true,
                    notify_new_devices: true,
                },
            });
            if (!user || !user.email)
                return;
            const browserInfo = (0, browserDetection_1.detectBrowser)(userAgent);
            const deviceInfo = (0, browserDetection_1.detectDeviceType)(userAgent);
            const alertIp = (0, browserDetection_1.formatIpAddress)(null, ipAddress);
            if (eventType === "login" && user.notify_new_devices) {
                const isNew = await SecurityService.isNewDevice(userId, deviceInfo.deviceType, browserInfo.browser);
                if (isNew) {
                    await emailService_1.EmailService.sendNewDeviceLoginEmail(user.email, user.full_name || "there", alertIp, location || "Unknown", deviceInfo.deviceType, browserInfo.browser);
                }
            }
            if (eventType === "login_failed" && user.email_unusual_logins) {
                await emailService_1.EmailService.sendUnusualLoginAlertEmail(user.email, user.full_name || "there", alertIp, location || "Unknown", deviceInfo.deviceType, browserInfo.browser);
            }
        }
        catch (error) {
            logger_1.default.error("Error sending security alert email:", error);
        }
    }
    static async isNewDevice(userId, deviceType, browser) {
        try {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            const recentLogins = await prisma_1.prisma.loginHistory.findMany({
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
        }
        catch {
            return true;
        }
    }
}
exports.SecurityService = SecurityService;
