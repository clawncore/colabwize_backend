"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
const platformAdmin_1 = require("../../middleware/platformAdmin");
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const auditLogService_1 = require("../../services/admin/auditLogService");
const router = express_1.default.Router();
router.use(platformAdmin_1.isPlatformAdmin);
// The shared `prisma` singleton in lib/prisma is typed `any` (global reuse
// pattern). Use a typed alias here so the generated delegate types are
// available and misuses are caught at compile time.
const db = prisma_1.prisma;
// ────────────────────────────────────────────────
// Dashboard / events
// ────────────────────────────────────────────────
router.get("/events", async (req, res) => {
    try {
        const limit = Math.min(parseInt(String(req.query.limit || "50")), 200);
        const events = await db.securityEvent.findMany({
            orderBy: { createdAt: "desc" },
            take: limit,
        });
        const userIds = [...new Set(events.map((e) => e.userId).filter(Boolean))];
        const adminIds = [...new Set(events.map((e) => e.adminId).filter(Boolean))];
        const [users, admins] = await Promise.all([
            userIds.length
                ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, full_name: true } })
                : [],
            adminIds.length
                ? db.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, email: true, full_name: true } })
                : [],
        ]);
        const userMap = new Map(users.map((u) => [u.id, u]));
        const adminMap = new Map(admins.map((a) => [a.id, a]));
        const enriched = events.map((e) => ({
            id: e.id,
            userId: e.userId,
            adminId: e.adminId,
            type: e.type,
            severity: e.severity,
            description: e.description,
            ipAddress: e.ipAddress,
            userAgent: e.userAgent,
            metadata: e.metadata,
            createdAt: e.createdAt,
            user: e.userId && userMap.has(e.userId)
                ? { email: userMap.get(e.userId).email, full_name: userMap.get(e.userId).full_name }
                : null,
            admin: e.adminId && adminMap.has(e.adminId)
                ? { email: adminMap.get(e.adminId).email, full_name: adminMap.get(e.adminId).full_name }
                : null,
        }));
        res.json({ success: true, data: { events: enriched } });
    }
    catch (error) {
        logger_1.default.error("Security events error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ────────────────────────────────────────────────
// Login audit
// ────────────────────────────────────────────────
router.get("/login-audit", async (req, res) => {
    try {
        const limit = Math.min(parseInt(String(req.query.limit || "50")), 200);
        const offset = parseInt(String(req.query.offset || "0"));
        const { userId, email, success, dateFrom, dateTo } = req.query;
        const where = {};
        if (userId)
            where.userId = String(userId);
        if (email)
            where.email = { contains: String(email), mode: "insensitive" };
        if (success !== undefined)
            where.success = success === "true";
        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom)
                where.createdAt.gte = new Date(String(dateFrom));
            if (dateTo)
                where.createdAt.lte = new Date(String(dateTo));
        }
        const [logs, total] = await Promise.all([
            db.loginAudit.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
            db.loginAudit.count({ where }),
        ]);
        res.json({
            success: true,
            data: {
                logs: logs.map((l) => ({
                    id: l.id,
                    userId: l.userId,
                    email: l.email,
                    success: l.success,
                    ipAddress: l.ipAddress,
                    userAgent: l.userAgent,
                    failureReason: l.failureReason,
                    createdAt: l.createdAt,
                })),
                total,
            },
        });
    }
    catch (error) {
        logger_1.default.error("Login audit error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ────────────────────────────────────────────────
// Active sessions
// ────────────────────────────────────────────────
router.get("/active-sessions", async (req, res) => {
    try {
        const sessions = await db.userSession.findMany({
            where: { ended_at: null },
            orderBy: { started_at: "desc" },
            take: 200,
            include: { user: { select: { email: true, full_name: true } } },
        });
        res.json({
            success: true,
            data: {
                sessions: sessions.map((s) => ({
                    id: s.id,
                    sessionId: s.session_id,
                    userId: s.user_id,
                    userEmail: s.user?.email ?? "unknown",
                    userName: s.user?.full_name ?? null,
                    startedAt: s.started_at,
                    ipAddress: s.ip_address,
                    userAgent: s.device_info || s.browser || null,
                })),
                total: sessions.length,
            },
        });
    }
    catch (error) {
        logger_1.default.error("Active sessions error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
router.post("/revoke-session", async (req, res) => {
    try {
        const { sessionId } = zod_1.z.object({ sessionId: zod_1.z.string().min(1) }).parse(req.body);
        const session = await db.userSession.findUnique({ where: { session_id: sessionId } });
        if (!session)
            return res.status(404).json({ success: false, error: "Session not found" });
        await db.userSession.update({
            where: { id: session.id },
            data: { ended_at: new Date() },
        });
        await (0, auditLogService_1.createAuditLog)({
            action: "SESSION_REVOKED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "UserSession",
            entityId: session.id,
            metadata: { userId: session.user_id },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("Revoke session error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
// ────────────────────────────────────────────────
// IP allowlist
// ────────────────────────────────────────────────
router.get("/ip-allowlist", async (req, res) => {
    try {
        const [entries, total] = await Promise.all([
            db.ipAllowlist.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
            db.ipAllowlist.count(),
        ]);
        res.json({ success: true, data: { entries, total } });
    }
    catch (error) {
        logger_1.default.error("IP allowlist error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
router.post("/ip-allowlist", async (req, res) => {
    try {
        const { ipAddress, cidr, description, blocked, reason } = zod_1.z
            .object({
            ipAddress: zod_1.z.string().min(1),
            cidr: zod_1.z.string().optional().nullable(),
            description: zod_1.z.string().optional().nullable(),
            blocked: zod_1.z.boolean().optional().default(false),
            reason: zod_1.z.string().optional().nullable(),
        })
            .parse(req.body);
        const entry = await db.ipAllowlist.create({
            data: {
                ipAddress,
                cidr: cidr || null,
                description: description || null,
                blocked,
                reason: reason || null,
                createdBy: (0, auditLogService_1.getAdminEmail)(req),
            },
        });
        await (0, auditLogService_1.createAuditLog)({
            action: blocked ? "IP_BLOCKED" : "IP_ALLOWED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "IpAllowlist",
            entityId: entry.id,
            metadata: { ipAddress },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true, entry });
    }
    catch (error) {
        logger_1.default.error("IP allowlist create error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
router.put("/ip-allowlist/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { blocked, description, cidr, reason } = zod_1.z
            .object({
            blocked: zod_1.z.boolean().optional(),
            description: zod_1.z.string().optional().nullable(),
            cidr: zod_1.z.string().optional().nullable(),
            reason: zod_1.z.string().optional().nullable(),
        })
            .parse(req.body);
        const entry = await db.ipAllowlist.update({
            where: { id },
            data: { blocked, description: description ?? undefined, cidr: cidr ?? undefined, reason: reason ?? undefined },
        });
        await (0, auditLogService_1.createAuditLog)({
            action: "IP_ALLOWLIST_UPDATED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "IpAllowlist",
            entityId: entry.id,
            metadata: { ipAddress: entry.ipAddress, blocked: entry.blocked },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true, entry });
    }
    catch (error) {
        logger_1.default.error("IP allowlist update error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
router.delete("/ip-allowlist/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const entry = await db.ipAllowlist.findUnique({ where: { id } });
        if (!entry)
            return res.status(404).json({ success: false, error: "Entry not found" });
        await db.ipAllowlist.delete({ where: { id } });
        await (0, auditLogService_1.createAuditLog)({
            action: "IP_ALLOWLIST_REMOVED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "IpAllowlist",
            entityId: id,
            metadata: { ipAddress: entry.ipAddress },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("IP allowlist delete error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
// ────────────────────────────────────────────────
// Account locks
// ────────────────────────────────────────────────
router.get("/account-locks", async (req, res) => {
    try {
        const [locks, total] = await Promise.all([
            db.accountLock.findMany({ orderBy: { lockedAt: "desc" }, take: 200 }),
            db.accountLock.count({ where: { unlockedAt: null } }),
        ]);
        const userIds = [...new Set(locks.map((l) => l.userId).filter(Boolean))];
        const users = userIds.length
            ? await db.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, email: true, full_name: true },
            })
            : [];
        const userMap = new Map(users.map((u) => [u.id, u]));
        res.json({
            success: true,
            data: {
                locks: locks.map((l) => ({
                    id: l.id,
                    userId: l.userId,
                    lockedAt: l.lockedAt,
                    unlockedAt: l.unlockedAt,
                    reason: l.reason,
                    lockedBy: l.lockedBy,
                    createdAt: l.createdAt,
                    updatedAt: l.updatedAt,
                    user: l.userId && userMap.has(l.userId)
                        ? { email: userMap.get(l.userId).email, full_name: userMap.get(l.userId).full_name }
                        : null,
                })),
                total,
            },
        });
    }
    catch (error) {
        logger_1.default.error("Account locks error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
router.post("/lock-account", async (req, res) => {
    try {
        const { userId, reason } = zod_1.z
            .object({ userId: zod_1.z.string().min(1), reason: zod_1.z.string().optional().default("Manual lock by admin") })
            .parse(req.body);
        const user = await db.user.findUnique({ where: { id: userId } });
        if (!user)
            return res.status(404).json({ success: false, error: "User not found" });
        const existing = await db.accountLock.findUnique({ where: { userId } });
        if (existing)
            return res.json({ success: true, alreadyLocked: true });
        await db.accountLock.create({
            data: { userId, reason, lockedBy: (0, auditLogService_1.getAdminEmail)(req) },
        });
        await (0, auditLogService_1.createAuditLog)({
            action: "ACCOUNT_LOCKED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "User",
            entityId: userId,
            metadata: { reason },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("Lock account error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
router.post("/unlock-account", async (req, res) => {
    try {
        const { userId } = zod_1.z.object({ userId: zod_1.z.string().min(1) }).parse(req.body);
        const lock = await db.accountLock.findUnique({ where: { userId } });
        if (!lock)
            return res.status(404).json({ success: false, error: "No active lock found" });
        await db.accountLock.update({
            where: { id: lock.id },
            data: { unlockedAt: new Date() },
        });
        await (0, auditLogService_1.createAuditLog)({
            action: "ACCOUNT_UNLOCKED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "User",
            entityId: userId,
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("Unlock account error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
// ────────────────────────────────────────────────
// 2FA administration
// ────────────────────────────────────────────────
router.get("/2fa-status", async (req, res) => {
    try {
        const { twoFactorEnabled } = req.query;
        const where = {};
        if (twoFactorEnabled !== undefined)
            where.two_factor_enabled = twoFactorEnabled === "true";
        const [users, total] = await Promise.all([
            db.user.findMany({
                where,
                select: { id: true, email: true, full_name: true, two_factor_enabled: true, two_factor_confirmed_at: true },
                orderBy: { created_at: "desc" },
                take: 200,
            }),
            db.user.count({ where }),
        ]);
        res.json({ success: true, data: { users, total } });
    }
    catch (error) {
        logger_1.default.error("2FA status error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
router.post("/force-2fa", async (req, res) => {
    try {
        const { userId, enable } = zod_1.z
            .object({ userId: zod_1.z.string().min(1), enable: zod_1.z.boolean() })
            .parse(req.body);
        const user = await db.user.findUnique({ where: { id: userId } });
        if (!user)
            return res.status(404).json({ success: false, error: "User not found" });
        await db.user.update({
            where: { id: userId },
            data: { two_factor_enabled: enable },
        });
        await (0, auditLogService_1.createAuditLog)({
            action: enable ? "TWO_FA_ENABLED" : "TWO_FA_DISABLED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "User",
            entityId: userId,
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("Force 2FA error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
// ────────────────────────────────────────────────
// API keys
// ────────────────────────────────────────────────
router.get("/api-keys", async (req, res) => {
    try {
        const [keys, total] = await Promise.all([
            db.apiKey.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
            db.apiKey.count({ where: { isActive: true } }),
        ]);
        const userIds = [...new Set(keys.map((k) => k.userId).filter(Boolean))];
        const users = userIds.length
            ? await db.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, email: true, full_name: true },
            })
            : [];
        const userMap = new Map(users.map((u) => [u.id, u]));
        res.json({
            success: true,
            data: {
                keys: keys.map((k) => ({
                    id: k.id,
                    userId: k.userId,
                    name: k.name,
                    keyHash: k.keyHash,
                    lastFour: k.lastFour,
                    permissions: k.permissions || [],
                    isActive: k.isActive,
                    lastUsedAt: k.lastUsedAt,
                    createdAt: k.createdAt,
                    revokedAt: k.revokedAt,
                    user: k.userId && userMap.has(k.userId)
                        ? { email: userMap.get(k.userId).email, full_name: userMap.get(k.userId).full_name }
                        : null,
                })),
                total,
            },
        });
    }
    catch (error) {
        logger_1.default.error("API keys error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
router.post("/api-keys", async (req, res) => {
    try {
        const { userId, name, permissions } = zod_1.z
            .object({
            userId: zod_1.z.string().min(1),
            name: zod_1.z.string().min(1),
            permissions: zod_1.z.array(zod_1.z.string()).optional().default([]),
        })
            .parse(req.body);
        const user = await db.user.findUnique({ where: { id: userId } });
        if (!user)
            return res.status(404).json({ success: false, error: "User not found" });
        const rawKey = `cwk_${crypto_1.default.randomBytes(24).toString("hex")}`;
        const keyHash = crypto_1.default.createHash("sha256").update(rawKey).digest("hex");
        await db.apiKey.create({
            data: {
                userId,
                name,
                keyHash,
                lastFour: rawKey.slice(-4),
                permissions: permissions,
            },
        });
        await (0, auditLogService_1.createAuditLog)({
            action: "API_KEY_CREATED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "ApiKey",
            metadata: { userId, name },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true, data: { rawKey } });
    }
    catch (error) {
        logger_1.default.error("API key create error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
router.post("/api-keys/:id/revoke", async (req, res) => {
    try {
        const { id } = req.params;
        const key = await db.apiKey.findUnique({ where: { id } });
        if (!key)
            return res.status(404).json({ success: false, error: "API key not found" });
        await db.apiKey.update({
            where: { id },
            data: { isActive: false, revokedAt: new Date() },
        });
        await (0, auditLogService_1.createAuditLog)({
            action: "API_KEY_REVOKED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "ApiKey",
            entityId: id,
            metadata: { userId: key.userId },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("API key revoke error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
// ────────────────────────────────────────────────
// Secret rotation
// ────────────────────────────────────────────────
const DEFAULT_SECRETS = [
    { key: "JWT_SECRET", label: "JWT Signing Secret", env: "JWT_SECRET" },
    { key: "ADMIN_JWT_SECRET", label: "Admin JWT Secret", env: "ADMIN_JWT_SECRET" },
    { key: "LEMONSQUEEZY_WEBHOOK_SECRET", label: "LemonSqueezy Webhook Secret", env: "LEMONSQUEEZY_WEBHOOK_SECRET" },
    { key: "GOOGLE_CLIENT_SECRET", label: "Google OAuth Secret", env: "GOOGLE_CLIENT_SECRET" },
    { key: "RESEND_API_KEY", label: "Resend API Key", env: "RESEND_API_KEY" },
    { key: "OPENAI_API_KEY", label: "OpenAI API Key", env: "OPENAI_API_KEY" },
    { key: "ANTHROPIC_API_KEY", label: "Anthropic API Key", env: "ANTHROPIC_API_KEY" },
];
async function ensureSecretRotationSeeded() {
    const existing = await db.secretRotation.count();
    if (existing > 0)
        return;
    await db.secretRotation.createMany({
        data: DEFAULT_SECRETS.map((s) => ({ key: s.key, label: s.label })),
    });
}
router.get("/secret-rotation", async (req, res) => {
    try {
        await ensureSecretRotationSeeded();
        const rows = await db.secretRotation.findMany({ orderBy: { lastRotated: "asc" } });
        res.json({ success: true, data: rows });
    }
    catch (error) {
        logger_1.default.error("Secret rotation error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
router.patch("/secret-rotation/:key", async (req, res) => {
    try {
        const { key } = req.params;
        const row = await db.secretRotation.findUnique({ where: { key } });
        if (!row)
            return res.status(404).json({ success: false, error: "Secret entry not found" });
        await db.secretRotation.update({
            where: { key },
            data: { lastRotated: new Date(), rotatedBy: (0, auditLogService_1.getAdminEmail)(req) },
        });
        await (0, auditLogService_1.createAuditLog)({
            action: "SECRET_ROTATED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "SecretRotation",
            entityId: row.id,
            metadata: { key },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("Secret rotate error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
// ────────────────────────────────────────────────
// Security configuration (persisted in system_config)
// ────────────────────────────────────────────────
const SECURITY_CONFIG_DEFAULTS = {
    "security.max_login_attempts": 5,
    "security.lockout_duration_minutes": 15,
    "security.session_timeout_minutes": 120,
    "security.require_2fa_for_admins": true,
    "security.ip_allowlist_enabled": false,
    "security.password_min_length": 8,
    "security.password_require_special_char": true,
    "security.password_require_number": true,
    "security.password_require_uppercase": true,
    "security.session_concurrent_limit": 5,
};
router.get("/config", async (req, res) => {
    try {
        const rows = await db.systemConfig.findMany({
            where: { key: { in: Object.keys(SECURITY_CONFIG_DEFAULTS) } },
        });
        const config = { ...SECURITY_CONFIG_DEFAULTS };
        for (const row of rows) {
            config[row.key] = row.value;
        }
        res.json({ success: true, data: config });
    }
    catch (error) {
        logger_1.default.error("Security config get error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
router.put("/config", async (req, res) => {
    try {
        const body = req.body;
        const keys = Object.keys(SECURITY_CONFIG_DEFAULTS);
        for (const key of keys) {
            if (key in body) {
                await db.systemConfig.upsert({
                    where: { key },
                    create: { key, value: body[key], description: `Security configuration: ${key}`, updatedBy: (0, auditLogService_1.getAdminEmail)(req) },
                    update: { value: body[key], updatedBy: (0, auditLogService_1.getAdminEmail)(req) },
                });
            }
        }
        await (0, auditLogService_1.createAuditLog)({
            action: "SECURITY_CONFIG_UPDATED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            metadata: { keys: keys.filter((k) => k in body) },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("Security config set error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ────────────────────────────────────────────────
// Audit log explorer
// ────────────────────────────────────────────────
router.get("/audit-log-explorer", async (req, res) => {
    try {
        const limit = Math.min(parseInt(String(req.query.limit || "50")), 200);
        const offset = parseInt(String(req.query.offset || "0"));
        const { action, entityType, adminEmail, dateFrom, dateTo } = req.query;
        const where = {};
        if (action)
            where.action = String(action);
        if (entityType)
            where.entityType = String(entityType);
        if (adminEmail)
            where.adminEmail = { contains: String(adminEmail), mode: "insensitive" };
        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom)
                where.createdAt.gte = new Date(String(dateFrom));
            if (dateTo)
                where.createdAt.lte = new Date(String(dateTo));
        }
        const [logs, total] = await Promise.all([
            db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
            db.auditLog.count({ where }),
        ]);
        res.json({
            success: true,
            data: { logs, total },
        });
    }
    catch (error) {
        logger_1.default.error("Audit log explorer error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.default = router;
