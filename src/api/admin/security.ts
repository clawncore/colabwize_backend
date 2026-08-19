import express, { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { isPlatformAdmin } from "../../middleware/platformAdmin";
import { adminOperationRateLimiter } from "../../middleware/rateLimiter";
import { prisma as prismaClient } from "../../lib/prisma";
import type { PrismaClient } from "@prisma/client";
import logger from "../../monitoring/logger";
import { createAuditLog, extractAuditContext, getAdminEmail } from "../../services/admin/auditLogService";

const router: Router = express.Router();

router.use(isPlatformAdmin);
// Rate-limit admin security operations — prevents abuse of heavy endpoints
// (vuln scan, audit log explorer, events) that could strain the database.
router.use(adminOperationRateLimiter);

// The shared `prisma` singleton in lib/prisma is typed `any` (global reuse
// pattern). Use a typed alias here so the generated delegate types are
// available and misuses are caught at compile time.
const db = prismaClient as PrismaClient;

// ────────────────────────────────────────────────
// Dashboard / events
// ────────────────────────────────────────────────
router.get("/events", async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || "50")), 200);
    const offset = parseInt(String(req.query.offset || "0"));
    const { severity, type, userId, adminId, ipAddress, dateFrom, dateTo, search } = req.query;

    const where: any = {};
    if (severity) where.severity = String(severity);
    if (type) where.type = { contains: String(type), mode: "insensitive" };
    if (userId) where.userId = String(userId);
    if (adminId) where.adminId = String(adminId);
    if (ipAddress) where.ipAddress = { contains: String(ipAddress), mode: "insensitive" };

    const parseDate = (val: string | undefined): Date | undefined => {
      if (!val) return undefined;
      const d = new Date(String(val));
      return isNaN(d.getTime()) ? undefined : d;
    };
    const from = parseDate(dateFrom);
    const to = parseDate(dateTo);
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    // Full-text search across description, type, ipAddress, metadata
    if (search) {
      const term = String(search).trim();
      where.OR = [
        { description: { contains: term, mode: "insensitive" } },
        { type: { contains: term, mode: "insensitive" } },
        { ipAddress: { contains: term, mode: "insensitive" } },
        { metadata: { contains: term, mode: "insensitive" } },
      ];
    }

    const [events, total] = await Promise.all([
      db.securityEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      db.securityEvent.count({ where }),
    ]);

    const userIds = [...new Set(events.map((e) => e.userId).filter(Boolean))] as string[];
    const adminIds = [...new Set(events.map((e) => e.adminId).filter(Boolean))] as string[];

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
        ? { email: userMap.get(e.userId)!.email, full_name: userMap.get(e.userId)!.full_name }
        : null,
      admin: e.adminId && adminMap.has(e.adminId)
        ? { email: adminMap.get(e.adminId)!.email, full_name: adminMap.get(e.adminId)!.full_name }
        : null,
    }));

    res.json({ success: true, data: { events: enriched, total, limit, offset } });
  } catch (error: any) {
    logger.error("Security events error:", error);
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
    const { userId, email, success, ipAddress, dateFrom, dateTo } = req.query;

    const where: any = {};
    if (userId) where.userId = String(userId);
    if (email) where.email = { contains: String(email), mode: "insensitive" };
    if (success !== undefined) where.success = success === "true";
    if (ipAddress) where.ipAddress = { contains: String(ipAddress), mode: "insensitive" };

    const parseDate = (val: string | undefined): Date | undefined => {
      if (!val) return undefined;
      const d = new Date(String(val));
      return isNaN(d.getTime()) ? undefined : d;
    };
    const from = parseDate(dateFrom);
    const to = parseDate(dateTo);
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
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
  } catch (error: any) {
    logger.error("Login audit error:", error);
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
  } catch (error: any) {
    logger.error("Active sessions error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/revoke-session", async (req, res) => {
  try {
    const { sessionId } = z.object({ sessionId: z.string().min(1) }).parse(req.body);
    const session = await db.userSession.findUnique({ where: { session_id: sessionId } });
    if (!session) return res.status(404).json({ success: false, error: "Session not found" });

    await db.userSession.update({
      where: { id: session.id },
      data: { ended_at: new Date() },
    });

    await createAuditLog({
      action: "SESSION_REVOKED",
      adminEmail: getAdminEmail(req),
      entityType: "UserSession",
      entityId: session.id,
      metadata: { userId: session.user_id },
      ...extractAuditContext(req),
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error("Revoke session error:", error);
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
  } catch (error: any) {
    logger.error("IP allowlist error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/ip-allowlist", async (req, res) => {
  try {
    const { ipAddress, cidr, description, blocked, reason } = z
      .object({
        ipAddress: z.string().min(1),
        cidr: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
        blocked: z.boolean().optional().default(false),
        reason: z.string().optional().nullable(),
      })
      .parse(req.body);

    const entry = await db.ipAllowlist.create({
      data: {
        ipAddress,
        cidr: cidr || null,
        description: description || null,
        blocked,
        reason: reason || null,
        createdBy: getAdminEmail(req),
      },
    });

    await createAuditLog({
      action: blocked ? "IP_BLOCKED" : "IP_ALLOWED",
      adminEmail: getAdminEmail(req),
      entityType: "IpAllowlist",
      entityId: entry.id,
      metadata: { ipAddress },
      ...extractAuditContext(req),
    });

    res.json({ success: true, entry });
  } catch (error: any) {
    logger.error("IP allowlist create error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put("/ip-allowlist/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { blocked, description, cidr, reason } = z
      .object({
        blocked: z.boolean().optional(),
        description: z.string().optional().nullable(),
        cidr: z.string().optional().nullable(),
        reason: z.string().optional().nullable(),
      })
      .parse(req.body);

    const entry = await db.ipAllowlist.update({
      where: { id },
      data: { blocked, description: description ?? undefined, cidr: cidr ?? undefined, reason: reason ?? undefined },
    });

    await createAuditLog({
      action: "IP_ALLOWLIST_UPDATED",
      adminEmail: getAdminEmail(req),
      entityType: "IpAllowlist",
      entityId: entry.id,
      metadata: { ipAddress: entry.ipAddress, blocked: entry.blocked },
      ...extractAuditContext(req),
    });

    res.json({ success: true, entry });
  } catch (error: any) {
    logger.error("IP allowlist update error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete("/ip-allowlist/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await db.ipAllowlist.findUnique({ where: { id } });
    if (!entry) return res.status(404).json({ success: false, error: "Entry not found" });

    await db.ipAllowlist.delete({ where: { id } });

    await createAuditLog({
      action: "IP_ALLOWLIST_REMOVED",
      adminEmail: getAdminEmail(req),
      entityType: "IpAllowlist",
      entityId: id,
      metadata: { ipAddress: entry.ipAddress },
      ...extractAuditContext(req),
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error("IP allowlist delete error:", error);
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

    const userIds = [...new Set(locks.map((l) => l.userId).filter(Boolean))] as string[];
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
            ? { email: userMap.get(l.userId)!.email, full_name: userMap.get(l.userId)!.full_name }
            : null,
        })),
        total,
      },
    });
  } catch (error: any) {
    logger.error("Account locks error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/lock-account", async (req, res) => {
  try {
    const { userId, reason } = z
      .object({ userId: z.string().min(1), reason: z.string().optional().default("Manual lock by admin") })
      .parse(req.body);

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const existing = await db.accountLock.findUnique({ where: { userId } });
    if (existing) return res.json({ success: true, alreadyLocked: true });

    await db.accountLock.create({
      data: { userId, reason, lockedBy: getAdminEmail(req) },
    });

    await createAuditLog({
      action: "ACCOUNT_LOCKED",
      adminEmail: getAdminEmail(req),
      entityType: "User",
      entityId: userId,
      metadata: { reason },
      ...extractAuditContext(req),
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error("Lock account error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/unlock-account", async (req, res) => {
  try {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.body);
    const lock = await db.accountLock.findUnique({ where: { userId } });
    if (!lock) return res.status(404).json({ success: false, error: "No active lock found" });

    await db.accountLock.update({
      where: { id: lock.id },
      data: { unlockedAt: new Date() },
    });

    await createAuditLog({
      action: "ACCOUNT_UNLOCKED",
      adminEmail: getAdminEmail(req),
      entityType: "User",
      entityId: userId,
      ...extractAuditContext(req),
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error("Unlock account error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// 2FA administration
// ────────────────────────────────────────────────
router.get("/2fa-status", async (req, res) => {
  try {
    const { twoFactorEnabled } = req.query;
    const where: any = {};
    if (twoFactorEnabled !== undefined) where.two_factor_enabled = twoFactorEnabled === "true";

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
  } catch (error: any) {
    logger.error("2FA status error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/force-2fa", async (req, res) => {
  try {
    const { userId, enable } = z
      .object({ userId: z.string().min(1), enable: z.boolean() })
      .parse(req.body);

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    await db.user.update({
      where: { id: userId },
      data: { two_factor_enabled: enable },
    });

    await createAuditLog({
      action: enable ? "TWO_FA_ENABLED" : "TWO_FA_DISABLED",
      adminEmail: getAdminEmail(req),
      entityType: "User",
      entityId: userId,
      ...extractAuditContext(req),
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error("Force 2FA error:", error);
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

    const userIds = [...new Set(keys.map((k) => k.userId).filter(Boolean))] as string[];
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
          permissions: (k.permissions as string[]) || [],
          isActive: k.isActive,
          lastUsedAt: k.lastUsedAt,
          createdAt: k.createdAt,
          revokedAt: k.revokedAt,
          user: k.userId && userMap.has(k.userId)
            ? { email: userMap.get(k.userId)!.email, full_name: userMap.get(k.userId)!.full_name }
            : null,
        })),
        total,
      },
    });
  } catch (error: any) {
    logger.error("API keys error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/api-keys", async (req, res) => {
  try {
    const { userId, name, permissions } = z
      .object({
        userId: z.string().min(1),
        name: z.string().min(1),
        permissions: z.array(z.string()).optional().default([]),
      })
      .parse(req.body);

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const rawKey = `cwk_${crypto.randomBytes(24).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

    await db.apiKey.create({
      data: {
        userId,
        name,
        keyHash,
        lastFour: rawKey.slice(-4),
        permissions: permissions as any,
      },
    });

    await createAuditLog({
      action: "API_KEY_CREATED",
      adminEmail: getAdminEmail(req),
      entityType: "ApiKey",
      metadata: { userId, name },
      ...extractAuditContext(req),
    });

    res.json({ success: true, data: { rawKey } });
  } catch (error: any) {
    logger.error("API key create error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/api-keys/:id/revoke", async (req, res) => {
  try {
    const { id } = req.params;
    const key = await db.apiKey.findUnique({ where: { id } });
    if (!key) return res.status(404).json({ success: false, error: "API key not found" });

    await db.apiKey.update({
      where: { id },
      data: { isActive: false, revokedAt: new Date() },
    });

    await createAuditLog({
      action: "API_KEY_REVOKED",
      adminEmail: getAdminEmail(req),
      entityType: "ApiKey",
      entityId: id,
      metadata: { userId: key.userId },
      ...extractAuditContext(req),
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error("API key revoke error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Secret rotation
// ────────────────────────────────────────────────
const DEFAULT_SECRETS: { key: string; label: string; env: string }[] = [
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
  if (existing > 0) return;
  await db.secretRotation.createMany({
    data: DEFAULT_SECRETS.map((s) => ({ key: s.key, label: s.label })),
  });
}

router.get("/secret-rotation", async (req, res) => {
  try {
    await ensureSecretRotationSeeded();
    const rows = await db.secretRotation.findMany({ orderBy: { lastRotated: "asc" } });
    res.json({ success: true, data: rows });
  } catch (error: any) {
    logger.error("Secret rotation error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch("/secret-rotation/:key", async (req, res) => {
  try {
    const { key } = req.params;
    const row = await db.secretRotation.findUnique({ where: { key } });
    if (!row) return res.status(404).json({ success: false, error: "Secret entry not found" });

    await db.secretRotation.update({
      where: { key },
      data: { lastRotated: new Date(), rotatedBy: getAdminEmail(req) },
    });

    await createAuditLog({
      action: "SECRET_ROTATED",
      adminEmail: getAdminEmail(req),
      entityType: "SecretRotation",
      entityId: row.id,
      metadata: { key },
      ...extractAuditContext(req),
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error("Secret rotate error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Security configuration (persisted in system_config)
// ────────────────────────────────────────────────
const SECURITY_CONFIG_DEFAULTS: Record<string, unknown> = {
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

// Zod schema for security config updates — enforces type safety on persisted values
const securityConfigSchema = z.object({
  "security.max_login_attempts": z.number().int().min(1).max(100).optional(),
  "security.lockout_duration_minutes": z.number().int().min(1).max(1440).optional(),
  "security.session_timeout_minutes": z.number().int().min(5).max(10080).optional(),
  "security.require_2fa_for_admins": z.boolean().optional(),
  "security.ip_allowlist_enabled": z.boolean().optional(),
  "security.password_min_length": z.number().int().min(4).max(128).optional(),
  "security.password_require_special_char": z.boolean().optional(),
  "security.password_require_number": z.boolean().optional(),
  "security.password_require_uppercase": z.boolean().optional(),
  "security.session_concurrent_limit": z.number().int().min(1).max(100).optional(),
});

router.get("/config", async (req, res) => {
  try {
    const rows = await db.systemConfig.findMany({
      where: { key: { in: Object.keys(SECURITY_CONFIG_DEFAULTS) } },
    });
    const config: Record<string, unknown> = { ...SECURITY_CONFIG_DEFAULTS };
    for (const row of rows) {
      config[row.key] = row.value;
    }
    res.json({ success: true, data: config });
  } catch (error: any) {
    logger.error("Security config get error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put("/config", async (req, res) => {
  try {
    // Validate body against Zod schema — rejects unknown keys and wrong types
    const body = securityConfigSchema.parse(req.body);
    const keys = Object.keys(SECURITY_CONFIG_DEFAULTS);

    for (const key of keys) {
      if (key in body) {
        await db.systemConfig.upsert({
          where: { key },
          create: { key, value: body[key] as any, description: `Security configuration: ${key}`, updatedBy: getAdminEmail(req) },
          update: { value: body[key] as any, updatedBy: getAdminEmail(req) },
        });
      }
    }

    await createAuditLog({
      action: "SECURITY_CONFIG_UPDATED",
      adminEmail: getAdminEmail(req),
      metadata: { keys: keys.filter((k) => k in body) },
      ...extractAuditContext(req),
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error("Security config set error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Vulnerability Scan
// ────────────────────────────────────────────────
router.get("/vulnerability-scan", async (req, res) => {
  try {
    const findings: {
      id: string;
      category: string;
      title: string;
      description: string;
      severity: "critical" | "high" | "medium" | "low" | "info";
      recommendation: string;
      affectedCount?: number;
      passed: boolean;
    }[] = [];

    // Load config once
    const configRows = await db.systemConfig.findMany({
      where: { key: { in: Object.keys(SECURITY_CONFIG_DEFAULTS) } },
    });
    const config: Record<string, unknown> = { ...SECURITY_CONFIG_DEFAULTS };
    for (const row of configRows) config[row.key] = row.value;

    // ── 1. 2FA Adoption ──────────────────────────────────────
    const [totalUsers, twoFaUsers] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { two_factor_enabled: true } }),
    ]);
    const twoFaRate = totalUsers > 0 ? (twoFaUsers / totalUsers) * 100 : 100;
    findings.push({
      id: "2fa-adoption",
      category: "Authentication",
      title: "2FA Adoption Rate",
      description: `${twoFaUsers} of ${totalUsers} users have 2FA enabled (${twoFaRate.toFixed(1)}%).`,
      severity: twoFaRate < 50 ? "critical" : twoFaRate < 80 ? "high" : twoFaRate < 95 ? "medium" : "low",
      recommendation: "Force 2FA for all users or at minimum all admin accounts. Use the 2FA Admin tab to enable it per user.",
      affectedCount: totalUsers - twoFaUsers,
      passed: twoFaRate >= 95,
    });

    // ── 2. Admin 2FA Requirement ──────────────────────────────
    const require2faAdmins = config["security.require_2fa_for_admins"] === true;
    findings.push({
      id: "admin-2fa-enforced",
      category: "Authentication",
      title: "Admin 2FA Enforcement",
      description: require2faAdmins
        ? "2FA is enforced for all administrator accounts."
        : "2FA is NOT enforced for admin accounts — a single compromised password can grant full admin access.",
      severity: require2faAdmins ? "info" : "critical",
      recommendation: "Enable 'Require 2FA for admins' in Security Config.",
      passed: require2faAdmins,
    });

    // ── 3. Password Policy ────────────────────────────────────
    const minLen = Number(config["security.password_min_length"] ?? 8);
    const requireSpecial = config["security.password_require_special_char"] === true;
    const requireNumber = config["security.password_require_number"] === true;
    const requireUpper = config["security.password_require_uppercase"] === true;
    const policyScore = [minLen >= 12, requireSpecial, requireNumber, requireUpper].filter(Boolean).length;
    findings.push({
      id: "password-policy",
      category: "Authentication",
      title: "Password Policy Strength",
      description: `Min length: ${minLen}. Special char: ${requireSpecial ? "✓" : "✗"}. Number: ${requireNumber ? "✓" : "✗"}. Uppercase: ${requireUpper ? "✓" : "✗"}.`,
      severity: policyScore <= 1 ? "high" : policyScore === 2 ? "medium" : policyScore === 3 ? "low" : "info",
      recommendation: "Set minimum password length to 12+ and enable all complexity requirements.",
      passed: policyScore === 4 && minLen >= 12,
    });

    // ── 4. Login Brute-Force Protection ──────────────────────
    const maxAttempts = Number(config["security.max_login_attempts"] ?? 5);
    findings.push({
      id: "brute-force-protection",
      category: "Access Control",
      title: "Login Brute-Force Lockout Threshold",
      description: `Accounts are locked after ${maxAttempts} failed login attempt(s).`,
      severity: maxAttempts > 10 ? "high" : maxAttempts > 5 ? "medium" : "info",
      recommendation: "Set max login attempts to 5 or fewer to prevent brute-force attacks.",
      passed: maxAttempts <= 5,
    });

    // ── 5. Recent Brute-Force Activity ────────────────────────
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const failedLogins = await db.loginAudit.count({
      where: { success: false, createdAt: { gte: since24h } },
    });
    findings.push({
      id: "brute-force-activity",
      category: "Threat Detection",
      title: "Failed Login Attempts (Last 24h)",
      description: `${failedLogins} failed login attempts detected in the past 24 hours.`,
      severity: failedLogins > 100 ? "critical" : failedLogins > 30 ? "high" : failedLogins > 10 ? "medium" : "info",
      recommendation: "Investigate IPs generating repeated failures. Consider adding CAPTCHA or rate limiting at the network layer.",
      affectedCount: failedLogins,
      passed: failedLogins <= 10,
    });

    // ── 6. Session Timeout ────────────────────────────────────
    const sessionTimeout = Number(config["security.session_timeout_minutes"] ?? 120);
    findings.push({
      id: "session-timeout",
      category: "Session Management",
      title: "Session Timeout Policy",
      description: `Sessions expire after ${sessionTimeout} minutes of inactivity.`,
      severity: sessionTimeout > 480 ? "high" : sessionTimeout > 240 ? "medium" : "info",
      recommendation: "Set session timeout to 60–120 minutes for most applications. Critical systems should use 30 minutes.",
      passed: sessionTimeout <= 120,
    });

    // ── 7. Concurrent Session Limit ───────────────────────────
    const concurrentLimit = Number(config["security.session_concurrent_limit"] ?? 5);
    findings.push({
      id: "concurrent-sessions",
      category: "Session Management",
      title: "Concurrent Session Limit",
      description: `Users can have up to ${concurrentLimit} active sessions simultaneously.`,
      severity: concurrentLimit > 5 ? "medium" : "info",
      recommendation: "Limit concurrent sessions to 3 or fewer to detect and prevent session sharing or credential theft.",
      passed: concurrentLimit <= 3,
    });

    // ── 8. Secret Rotation Overdue ────────────────────────────
    await ensureSecretRotationSeeded();
    const secretRows = await db.secretRotation.findMany();
    const overdueSecrets = secretRows.filter((s) => {
      const daysAgo = (Date.now() - new Date(s.lastRotated).getTime()) / (1000 * 60 * 60 * 24);
      return daysAgo > s.rotationDays;
    });
    findings.push({
      id: "secret-rotation",
      category: "Secrets Management",
      title: "Overdue Secret Rotations",
      description:
        overdueSecrets.length === 0
          ? "All secrets are within their rotation schedules."
          : `${overdueSecrets.length} secret(s) are overdue for rotation: ${overdueSecrets.map((s) => s.label).join(", ")}.`,
      severity: overdueSecrets.length > 3 ? "critical" : overdueSecrets.length > 0 ? "high" : "info",
      recommendation: "Rotate overdue secrets immediately from the Secret Rotation tab. Automate rotation with a CI/CD secret manager.",
      affectedCount: overdueSecrets.length,
      passed: overdueSecrets.length === 0,
    });

    // ── 9. Stale Active API Keys ──────────────────────────────
    const staleKeyThreshold = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const staleKeys = await db.apiKey.count({
      where: {
        isActive: true,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: staleKeyThreshold } }],
      },
    });
    findings.push({
      id: "stale-api-keys",
      category: "Secrets Management",
      title: "Stale Active API Keys",
      description:
        staleKeys === 0
          ? "All active API keys have been used within the past 90 days."
          : `${staleKeys} active API key(s) haven't been used in over 90 days.`,
      severity: staleKeys > 5 ? "high" : staleKeys > 0 ? "medium" : "info",
      recommendation: "Revoke unused API keys immediately. Implement automatic expiry for keys unused after 90 days.",
      affectedCount: staleKeys,
      passed: staleKeys === 0,
    });

    // ── 10. Locked Accounts Backlog ───────────────────────────
    const activeLocks = await db.accountLock.count({ where: { unlockedAt: null } });
    findings.push({
      id: "locked-accounts",
      category: "Access Control",
      title: "Unresolved Account Locks",
      description:
        activeLocks === 0
          ? "No accounts are currently locked."
          : `${activeLocks} account(s) are currently locked and awaiting review.`,
      severity: activeLocks > 10 ? "high" : activeLocks > 0 ? "medium" : "info",
      recommendation: "Review locked accounts regularly. Persistent locks may indicate an ongoing attack or forgotten user.",
      affectedCount: activeLocks,
      passed: activeLocks === 0,
    });

    // ── 11. IP Allowlist Hardening ────────────────────────────
    const ipAllowlistEnabled = config["security.ip_allowlist_enabled"] === true;
    const ipCount = await db.ipAllowlist.count({ where: { blocked: false } });
    findings.push({
      id: "ip-allowlist",
      category: "Network Security",
      title: "IP Allowlist Enforcement",
      description: ipAllowlistEnabled
        ? `IP allowlist is active with ${ipCount} allowed address(es).`
        : "IP allowlist is disabled. Any IP address can attempt access.",
      severity: ipAllowlistEnabled ? "info" : "medium",
      recommendation:
        "Enable IP allowlisting for admin panel access. Restrict to your office IPs or VPN egress range.",
      passed: ipAllowlistEnabled,
    });

    // ── 12. Critical Security Events (Last 7 days) ────────────
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const criticalEvents = await db.securityEvent.count({
      where: { severity: "critical", createdAt: { gte: since7d } },
    });
    findings.push({
      id: "critical-events",
      category: "Threat Detection",
      title: "Critical Security Events (Last 7 Days)",
      description:
        criticalEvents === 0
          ? "No critical security events recorded in the past week."
          : `${criticalEvents} critical security event(s) detected in the past 7 days.`,
      severity: criticalEvents > 5 ? "critical" : criticalEvents > 0 ? "high" : "info",
      recommendation: "Review all critical events in the Login Audit and Dashboard tabs. Correlate with IP and user activity.",
      affectedCount: criticalEvents,
      passed: criticalEvents === 0,
    });

    const score = Math.round((findings.filter((f) => f.passed).length / findings.length) * 100);
    const criticalCount = findings.filter((f) => !f.passed && f.severity === "critical").length;
    const highCount = findings.filter((f) => !f.passed && f.severity === "high").length;
    const mediumCount = findings.filter((f) => !f.passed && f.severity === "medium").length;

    await createAuditLog({
      action: "VULNERABILITY_SCAN_RUN",
      adminEmail: getAdminEmail(req),
      metadata: { score, criticalCount, highCount, mediumCount },
      ...extractAuditContext(req),
    });

    res.json({
      success: true,
      data: {
        score,
        criticalCount,
        highCount,
        mediumCount,
        totalChecks: findings.length,
        passedChecks: findings.filter((f) => f.passed).length,
        scannedAt: new Date().toISOString(),
        findings,
      },
    });
  } catch (error: any) {
    logger.error("Vulnerability scan error:", error);
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
    const {
      action,
      entityType,
      entityId,
      adminEmail,
      ipAddress,
      search,
      dateFrom,
      dateTo,
      sortBy = "createdAt",
      sortDir = "desc",
    } = req.query;

    // Validate sort field to prevent injection
    const allowedSortFields = ["createdAt", "action", "adminEmail", "entityType", "id"];
    const sortField = allowedSortFields.includes(String(sortBy)) ? String(sortBy) : "createdAt";
    const sortDirection = String(sortDir).toLowerCase() === "asc" ? "asc" : "desc";

    // Validate date formats
    const parseDate = (val: string | undefined): Date | undefined => {
      if (!val) return undefined;
      const d = new Date(String(val));
      return isNaN(d.getTime()) ? undefined : d;
    };
    const from = parseDate(dateFrom);
    const to = parseDate(dateTo);

    const where: any = {};
    if (action) where.action = { contains: String(action), mode: "insensitive" };
    if (entityType) where.entityType = { contains: String(entityType), mode: "insensitive" };
    if (entityId) where.entityId = String(entityId);
    if (adminEmail) where.adminEmail = { contains: String(adminEmail), mode: "insensitive" };
    if (ipAddress) where.ipAddress = { contains: String(ipAddress), mode: "insensitive" };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    // Full-text search across metadata JSON and userAgent
    if (search) {
      const term = String(search).trim();
      const OR: any[] = [
        { adminEmail: { contains: term, mode: "insensitive" } },
        { action: { contains: term, mode: "insensitive" } },
        { entityType: { contains: term, mode: "insensitive" } },
        { ipAddress: { contains: term, mode: "insensitive" } },
        { userAgent: { contains: term, mode: "insensitive" } },
      ];
      // Prisma JSON contains search (PostgreSQL)
      OR.push({ metadata: { contains: term, mode: "insensitive" } });
      where.OR = OR;
    }

    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { [sortField]: sortDirection },
        take: limit,
        skip: offset,
      }),
      db.auditLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        logs: logs.map((l) => ({
          id: l.id,
          action: l.action,
          adminEmail: l.adminEmail,
          entityType: l.entityType,
          entityId: l.entityId,
          metadata: l.metadata,
          ipAddress: l.ipAddress,
          userAgent: l.userAgent,
          createdAt: l.createdAt,
        })),
        total,
        limit,
        offset,
      },
    });
  } catch (error: any) {
    logger.error("Audit log explorer error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
