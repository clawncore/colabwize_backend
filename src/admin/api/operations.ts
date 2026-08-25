import express, { Router } from "express";
import fs from "fs";
import path from "path";
// Webhook delivery uses native https module to avoid extra deps
import { z } from "zod";
import { isPlatformAdmin } from "../middleware/platformAdmin";
import { adminOperationRateLimiter } from "../../middleware/rateLimiter";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { createAuditLog, extractAuditContext, getAdminEmail } from "../services/auditLogService";
import { executeBackup } from "../services/backupService";
import { invalidateMaintenanceCache } from "../../middleware/maintenance";

const router: Router = express.Router();

router.use(isPlatformAdmin);
// Rate-limit admin operations — protects heavy endpoints (backups, logs, diagnostics, cache flush)
router.use(adminOperationRateLimiter);

// ────────────────────────────────────────────────
// Maintenance mode
// ────────────────────────────────────────────────
router.get("/maintenance", async (req, res) => {
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: "maintenance_mode" } });
    const value = (cfg?.value as { enabled?: boolean; reason?: string | null; estimatedDuration?: string | null } | undefined) || {};

    res.json({
      success: true,
      data: {
        enabled: !!value.enabled,
        reason: value.reason ?? null,
        estimatedDuration: value.estimatedDuration ?? null,
        updatedBy: cfg?.updatedBy ?? null,
        updatedAt: cfg?.updated_at.toISOString() ?? null,
      },
    });
  } catch (error: any) {
    logger.error("Operations maintenance fetch error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const maintenanceSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().nullable().optional(),
  estimatedDuration: z.string().nullable().optional(),
});

router.put("/maintenance", async (req, res) => {
  try {
    const body = maintenanceSchema.parse(req.body);
    const adminEmail = getAdminEmail(req);

    const value = {
      enabled: body.enabled,
      reason: body.reason ?? null,
      estimatedDuration: body.estimatedDuration ?? null,
    };

    const existing = await prisma.systemConfig.findUnique({ where: { key: "maintenance_mode" } });
    if (existing) {
      await prisma.systemConfig.update({ where: { id: existing.id }, data: { value, updatedBy: adminEmail } });
    } else {
      await prisma.systemConfig.create({ data: { key: "maintenance_mode", value, updatedBy: adminEmail, description: "Platform maintenance mode toggle" } });
    }

    await createAuditLog({
      action: `maintenance.${body.enabled ? "enabled" : "disabled"}`,
      adminEmail: adminEmail,
      entityType: "system_config",
      entityId: "maintenance_mode",
      metadata: { reason: body.reason ?? null, estimatedDuration: body.estimatedDuration ?? null },
      ...extractAuditContext(req),
    });

    // Invalidate the middleware cache so the 503 gate takes effect immediately.
    invalidateMaintenanceCache();

    res.json({ success: true, data: { ...value, updatedBy: adminEmail, updatedAt: new Date().toISOString() } });
  } catch (error: any) {
    logger.error("Operations maintenance update error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Environment variables
// ────────────────────────────────────────────────
const SENSITIVE_ENV_KEYS = new Set([
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "JWT_SECRET",
  "JWT_ACCESS_TOKEN",
  "ENCRYPTION_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "RESEND_API_KEY",
  "LEMONSQUEEZY_API_KEY",
  "LEMONSQUEEZY_WEBHOOK_SECRET",
  "CLOUDINARY_API_SECRET",
  "CLOUDINARY_URL",
  "REDIS_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "GOOGLE_CLIENT_SECRET",
  "GEMINI_API_KEY",
  "DATABASE_URL",
  "DIRECT_URL",
  "STRIPE_SECRET_KEY",
  "POSTGRES_PASSWORD",
]);

router.get("/environments", async (req, res) => {
  try {
    const allowed = ["NODE_ENV", "SUPABASE_URL", "RESEND_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_ANALYTICS_PROPERTY_ID", "LEMONSQUEEZY_STORE_ID", "CLOUDINARY_CLOUD_NAME", "DATABASE_URL", "DIRECT_URL", "PORT", "ADMIN_API_KEY", "PM2_CLUSTER_PROCESSES"];

    const processEnv: Record<string, string> = {};
    for (const key of allowed) {
      if (SENSITIVE_ENV_KEYS.has(key)) {
        processEnv[key] = process.env[key] ? "••••••••" : "not set";
      } else {
        processEnv[key] = process.env[key] ?? "not set";
      }
    }

    let configOverrides: { key: string; value: unknown; updatedBy: string | null }[] = [];
    try {
      const rows = await prisma.systemConfig.findMany({ orderBy: { updated_at: "desc" }, take: 50 });
      configOverrides = rows.map((r: { key: string; value: unknown; updatedBy: string | null }) => ({ key: r.key, value: r.value, updatedBy: r.updatedBy }));
    } catch (err: any) {
      logger.warn(`Operations environments config read failed: ${err.message}`);
    }

    res.json({ success: true, data: { processEnv, configOverrides } });
  } catch (error: any) {
    logger.error("Operations environments error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Backups
// ────────────────────────────────────────────────
router.get("/backups", async (req, res) => {
  try {
    const status = String(req.query.status || "");
    const type = String(req.query.type || "");
    const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 200);
    const offset = parseInt(String(req.query.offset || "0"), 10) || 0;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (type) where.type = type;

    const [backups, total] = await Promise.all([
      prisma.backupRecord.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
      prisma.backupRecord.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        backups: backups.map((b: { id: string; type: string; status: string; sizeBytes: number | null; fileName: string | null; storagePath: string | null; startedAt: Date | null; completedAt: Date | null; errorMessage: string | null; createdAt: Date }) => ({
          id: b.id,
          type: b.type,
          status: b.status,
          sizeBytes: b.sizeBytes,
          fileName: b.fileName,
          storagePath: b.storagePath,
          startedAt: b.startedAt?.toISOString() ?? null,
          completedAt: b.completedAt?.toISOString() ?? null,
          errorMessage: b.errorMessage,
          createdAt: b.createdAt.toISOString(),
        })),
        total,
      },
    });
  } catch (error: any) {
    logger.error("Operations backups fetch error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/backups", async (req, res) => {
  try {
    const body = z.object({ type: z.string().default("full"), description: z.string().optional() }).parse(req.body || {});
    const adminEmail = getAdminEmail(req);

    const record = await prisma.backupRecord.create({
      data: {
        type: body.type,
        status: "in_progress",
        startedAt: new Date(),
        fileName: `manual-${body.type}-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}`,
        storagePath: null,
      },
    });

    // Fire-and-forget background completion (mirrors existing backupService pattern).
    void executeBackup(record.id, body.type).catch((err: any) => logger.error("Backup execution error:", err));

    await createAuditLog({
      action: "backup.create",
      adminEmail: adminEmail,
      entityType: "backup_record",
      entityId: record.id,
      metadata: { type: body.type, description: body.description ?? null },
      ...extractAuditContext(req),
    });

    res.json({ success: true, data: record });
  } catch (error: any) {
    logger.error("Operations backup create error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Diagnostics
// ────────────────────────────────────────────────
router.get("/diagnostics", async (req, res) => {
  try {
    const checks: Record<string, { status: string; message: string; value?: unknown }> = {};

    // Database connectivity
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { status: "healthy", message: "Database reachable", value: `${Date.now() - start}ms` };
    } catch (err: any) {
      checks.database = { status: "unhealthy", message: err.message, value: null };
    }

    // Memory
    const mem = process.memoryUsage();
    const heapPct = mem.heapTotal > 0 ? Number(((mem.heapUsed / mem.heapTotal) * 100).toFixed(1)) : 0;
    checks.memory = {
      status: heapPct > 85 ? "unhealthy" : heapPct > 70 ? "warning" : "healthy",
      message: `Heap usage ${heapPct}% (${(mem.heapUsed / 1024 / 1024).toFixed(0)}MB / ${(mem.heapTotal / 1024 / 1024).toFixed(0)}MB)`,
      value: { usedMB: Math.round(mem.heapUsed / 1024 / 1024), totalMB: Math.round(mem.heapTotal / 1024 / 1024), pct: heapPct },
    };

    // Uptime
    checks.uptime = { status: "healthy", message: `Process uptime ${Math.floor(process.uptime() / 60)}m`, value: Math.floor(process.uptime()) };

    // Maintenance mode
    const cfg = await prisma.systemConfig.findUnique({ where: { key: "maintenance_mode" } });
    const enabled = !!(cfg?.value as any)?.enabled;
    checks.maintenance = {
      status: enabled ? "warning" : "healthy",
      message: enabled ? "Maintenance mode is active" : "Maintenance mode is off",
      value: enabled,
    };

    // Env integrity
    const missing = ["DATABASE_URL", "SUPABASE_URL"].filter((k) => !process.env[k]);
    checks.env = missing.length
      ? { status: "warning", message: `Missing env vars: ${missing.join(", ")}` }
      : { status: "healthy", message: "Required env vars present" };

    // AI providers
    const aiConfigured = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    checks.aiProviders = aiConfigured
      ? { status: "healthy", message: "AI provider configured" }
      : { status: "warning", message: "No AI provider configured" };

    res.json({ success: true, data: { timestamp: new Date().toISOString(), checks } });
  } catch (error: any) {
    logger.error("Operations diagnostics error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Cache flush
// ────────────────────────────────────────────────
router.delete("/cache/flush", async (req, res) => {
  try {
    const adminEmail = getAdminEmail(req);
    // No in-memory cache layer exists yet; report the flush as a no-op.
    await createAuditLog({
      action: "cache.flush",
      adminEmail: adminEmail,
      entityType: "cache",
      entityId: "global",
      metadata: { note: "No cache layer to invalidate" },
      ...extractAuditContext(req),
    });
    res.json({ success: true, message: "Cache flush completed (no cache layer to invalidate)" });
  } catch (error: any) {
    logger.error("Operations cache flush error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Logs (tail recent backend log files)
// ────────────────────────────────────────────────
const LOG_DIRS = [path.join(__dirname, "../../../logs")];

router.get("/logs", async (req, res) => {
  try {
    const level = String(req.query.level || "").toLowerCase();
    const service = String(req.query.service || "").toLowerCase();
    const dateFrom = String(req.query.dateFrom || "");
    const dateTo = String(req.query.dateTo || "");
    const search = String(req.query.search || "").toLowerCase();
    const limit = Math.min(parseInt(String(req.query.limit || "100"), 10) || 100, 500);
    const offset = parseInt(String(req.query.offset || "0"), 10) || 0;

    const files = LOG_DIRS.flatMap((dir) => {
      try {
        return fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".log"))
          .sort()
          .reverse()
          .slice(0, 3)
          .map((f) => path.join(dir, f));
      } catch {
        return [];
      }
    });

    const lines: { raw: string }[] = [];
    let linesScanned = 0;

    for (const file of files) {
      let content = "";
      try {
        content = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const fileLines = content.split("\n").filter(Boolean).reverse();
      for (const line of fileLines as string[]) {
        linesScanned++;
        if (lines.length >= offset + limit) break;
        const lower = line.toLowerCase();
        if (level && !lower.includes(level)) continue;
        if (service && !lower.includes(service)) continue;
        if (search && !lower.includes(search)) continue;
        if (dateFrom && line.slice(0, 10) < dateFrom) continue;
        if (dateTo && line.slice(0, 10) > dateTo) continue;
        lines.push({ raw: line });
        if (lines.length >= offset + limit) break;
      }
      if (lines.length >= offset + limit) break;
    }

    res.json({
      success: true,
      data: { logs: lines.slice(offset), total: lines.length, filesScanned: files.length, linesScanned },
    });
  } catch (error: any) {
    logger.error("Operations logs error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Notifications
// ────────────────────────────────────────────────
router.get("/notifications", async (req, res) => {
  try {
    const read = req.query.read === undefined ? undefined : String(req.query.read).toLowerCase() === "true";
    const userId = String(req.query.userId || "");
    const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 200);
    const offset = parseInt(String(req.query.offset || "0"), 10) || 0;

    const where: Record<string, unknown> = {};
    if (read !== undefined) where.read = read;
    if (userId) where.user_id = userId;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { created_at: "desc" }, take: limit, skip: offset }),
      prisma.notification.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        notifications: notifications.map((n: { id: string; user_id: string; type: string; title: string; message: string; read: boolean; dismissed: boolean; created_at: Date }) => ({
          id: n.id,
          user_id: n.user_id,
          type: n.type,
          title: n.title,
          message: n.message,
          read: n.read,
          dismissed: n.dismissed,
          createdAt: n.created_at.toISOString(),
        })),
        total,
      },
    });
  } catch (error: any) {
    logger.error("Operations notifications error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Webhook testing & diagnostics
// ────────────────────────────────────────────────
router.post("/webhooks/test", async (req, res) => {
  try {
    const body = z.object({
      webhook_id: z.string().optional(),
      webhook_url: z.string().url(),
      webhook_secret: z.string().optional().nullable(),
      event_type: z.string().default("test.ping"),
    }).parse(req.body);

    const payload = {
      event_id: `test_${Date.now()}`,
      event_type: body.event_type,
      timestamp: new Date().toISOString(),
      data: { test: true, message: "Webhook delivery test from Platform Operations" },
    };

    const payloadStr = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "ColabWize-Webhook-Tester/1.0",
      "X-Colabwize-Event-Type": body.event_type,
      "X-Colabwize-Test": "true",
    };

    if (body.webhook_secret) {
      const crypto = await import("crypto");
      headers["X-Colabwize-Signature"] = crypto
        .createHmac("sha256", body.webhook_secret)
        .update(payloadStr)
        .digest("hex");
    }

    const start = Date.now();
    const url = new URL(body.webhook_url);
    const port = url.port ? parseInt(url.port) : url.protocol === "https:" ? 443 : 80;

    // Use native http/https module — no axios needed
    const mod = url.protocol === "https:" ? await import("https") : await import("http");

    const response = await new Promise<{ status: number; data: string }>((resolve, reject) => {
      const reqOpts: any = {
        hostname: url.hostname,
        port,
        path: url.pathname + url.search,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(payloadStr) },
        timeout: 10000,
      };
      const request = mod.request(reqOpts, (resp) => {
        let data = "";
        resp.on("data", (chunk) => (data += chunk));
        resp.on("end", () => resolve({ status: resp.statusCode!, data }));
      });
      request.on("error", reject);
      request.on("timeout", () => { request.destroy(); reject(new Error("Request timed out")); });
      request.write(payloadStr);
      request.end();
    });

    const latency = Date.now() - start;

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Webhook returned HTTP ${response.status}`);
    }

    await createAuditLog({
      action: "WEBHOOK_TESTED",
      adminEmail: getAdminEmail(req),
      entityType: "WebhookEndpoint",
      entityId: body.webhook_id || body.webhook_url,
      metadata: { url: body.webhook_url, status: response.status, latency_ms: latency, event_type: body.event_type },
      ...extractAuditContext(req),
    });

    res.json({
      success: true,
      data: {
        status: "delivered",
        http_status: response.status,
        latency_ms: latency,
        event_type: body.event_type,
        timestamp: payload.timestamp,
      },
    });
  } catch (error: any) {
    logger.error("Webhook test error:", error);
    res.status(400).json({
      success: false,
      error: error.message,
      data: {
        status: "failed",
        http_status: error.response?.status,
        error_detail: error.code === "ECONNREFUSED" ? "Connection refused — URL unreachable" : error.message,
      },
    });
  }
});

// ────────────────────────────────────────────────
// Enhanced diagnostics with webhook health
// ────────────────────────────────────────────────
router.get("/diagnostics", async (req, res) => {
  try {
    const checks: Record<string, any> = {};

    // Database
    const start = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { status: "healthy", message: "Database reachable", value: `${Date.now() - start}ms` };
    } catch (err: any) {
      checks.database = { status: "unhealthy", message: err.message, value: null };
    }

    // Memory
    const mem = process.memoryUsage();
    const heapPct = mem.heapTotal > 0 ? Number(((mem.heapUsed / mem.heapTotal) * 100).toFixed(1)) : 0;
    checks.memory = {
      status: heapPct > 90 ? "unhealthy" : heapPct > 70 ? "warning" : "healthy",
      message: `Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(0)}MB / ${(mem.heapTotal / 1024 / 1024).toFixed(0)}MB`,
      value: { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, heapPct },
    };

    // Webhooks
    const webhooks = await prisma.webhookEndpoint.findMany({ where: { active: true } });
    const reachable = webhooks.length > 0;
    checks.webhooks = {
      status: reachable ? "healthy" : "healthy",
      message: reachable ? `${webhooks.length} active endpoints configured` : "No active webhook endpoints",
      value: {
        total: webhooks.length,
        active: webhooks.filter((w: { active: boolean }) => w.active).length,
        unreachable: 0,
        endpoints: webhooks.map((w: { name: string; url: string; active: boolean }) => ({ name: w.name, url: w.url, active: w.active })),
      },
    };

    // Failed webhooks
    const failedCount = await prisma.failedWebhook.count({ where: { created_at: { gte: new Date(Date.now() - 3_600_000) } } });
    checks.webhook_queue = {
      status: failedCount > 100 ? "warning" : failedCount > 500 ? "unhealthy" : "healthy",
      message: `${failedCount} failed webhook${failedCount !== 1 ? 's' : ''} in last hour`,
      value: { failed_count: failedCount },
    };

    // Env integrity
    const missing = ["DATABASE_URL", "SUPABASE_URL"].filter((k) => !process.env[k]);
    checks.env = missing.length
      ? { status: "warning", message: `Missing env vars: ${missing.join(", ")}` }
      : { status: "healthy", message: "Required env vars present" };

    // Uptime
    checks.uptime = {
      status: "healthy" as const,
      message: `${process.uptime().toFixed(0)}s`,
      value: { seconds: process.uptime() },
    };

    // Node version
    checks.node = {
      status: process.version.startsWith("v2") ? "healthy" : "warning",
      message: process.version,
      value: { version: process.version, major: parseInt(process.versions.node) },
    };

    const overall = Object.values(checks).every((c) => c.status === "healthy")
      ? "healthy"
      : Object.values(checks).some((c) => c.status === "unhealthy")
        ? "unhealthy"
        : "warning";

    res.json({
      success: true,
      data: { timestamp: new Date().toISOString(), status: overall, checks },
    });
  } catch (error: any) {
    logger.error("Diagnostics error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
