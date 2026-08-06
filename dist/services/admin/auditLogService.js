"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuditLog = createAuditLog;
exports.extractAuditContext = extractAuditContext;
exports.getAdminEmail = getAdminEmail;
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
/**
 * Creates an audit log entry. Fire-and-forget — failures are logged but
 * do not affect the primary operation.
 */
async function createAuditLog(entry) {
    try {
        await prisma_1.prisma.auditLog.create({
            data: {
                action: entry.action,
                adminId: entry.adminId,
                adminEmail: entry.adminEmail,
                entityType: entry.entityType,
                entityId: entry.entityId,
                metadata: entry.metadata ? JSON.stringify(entry.metadata) : undefined,
                ipAddress: entry.ipAddress,
                userAgent: entry.userAgent,
            },
        });
    }
    catch (err) {
        logger_1.default.error("Audit log write failed:", { action: entry.action, error: err.message });
    }
}
/**
 * Extracts audit-relevant context from an Express request.
 */
function extractAuditContext(req) {
    return {
        ipAddress: req.ip ?? req.headers["x-forwarded-for"],
        userAgent: req.get("user-agent") ?? undefined,
        adminId: req.adminUser?.id ?? undefined,
    };
}
/**
 * Gets the admin email from a request object attached by auth middleware.
 */
function getAdminEmail(req) {
    return req.adminUser?.email ?? req.user?.email ?? "unknown-admin";
}
