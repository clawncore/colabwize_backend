import express, { Router } from "express";
import { z } from "zod";
import { isPlatformAdmin } from "../../middleware/platformAdmin";
import { adminOperationRateLimiter } from "../../middleware/rateLimiter";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { createAuditLog, extractAuditContext, getAdminEmail } from "../../services/admin/auditLogService";

const router: Router = express.Router();

router.use(isPlatformAdmin);
router.use(adminOperationRateLimiter);

// ────────────────────────────────────────────────
// Feature flags
// ────────────────────────────────────────────────

// Default feature flags seeded on first request so the UI isn't empty.
const DEFAULT_FEATURE_FLAGS: Array<{
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  rollout: number;
  environment: string;
}> = [
  {
    key: "new_dashboard",
    name: "New Dashboard",
    description: "Redesigned analytics dashboard with realtime charts",
    enabled: false,
    rollout: 25,
    environment: "production",
  },
  {
    key: "new_editor",
    name: "Tiptap v2 Editor",
    description: "Upgraded rich-text editor with collaborative cursors",
    enabled: true,
    rollout: 100,
    environment: "production",
  },
  {
    key: "collaboration_v2",
    name: "Collaboration v2",
    description: "Hocuspocus-backed real-time collaboration with offline sync",
    enabled: true,
    rollout: 100,
    environment: "production",
  },
  {
    key: "ai_citation_check",
    name: "AI Citation Verification",
    description: "GPT-powered citation accuracy verification",
    enabled: false,
    rollout: 10,
    environment: "production",
  },
  {
    key: "beta_program",
    name: "Beta Program Access",
    description: "Allow opted-in users to access beta features",
    enabled: false,
    rollout: 0,
    environment: "production",
  },
  {
    key: "referral_rewards",
    name: "Referral Rewards",
    description: "Credit-based referral reward system",
    enabled: false,
    rollout: 50,
    environment: "production",
  },
  {
    key: "stripe_billing_v2",
    name: "Stripe Billing v2",
    description: "New subscription billing UI with metered usage",
    enabled: false,
    rollout: 5,
    environment: "production",
  },
];

router.get("/feature-flags", async (req, res) => {
  try {
    let flags = await prisma.featureFlag.findMany({ orderBy: { created_at: "desc" } });

    // Seed defaults on first load so admins see something meaningful
    if (flags.length === 0) {
      for (const flag of DEFAULT_FEATURE_FLAGS) {
        await prisma.featureFlag.upsert({
          where: { key: flag.key },
          update: {},
          create: flag,
        }).catch(() => {
          // ignore duplicates from concurrent first-loads
        });
      }
      flags = await prisma.featureFlag.findMany({ orderBy: { created_at: "desc" } });
    }

    res.json({ success: true, data: flags });
  } catch (error: any) {
    logger.error("Feature flags fetch error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const flagSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  enabled: z.boolean().optional().default(false),
  rollout: z.number().min(0).max(100).optional().default(0),
  variant: z.unknown().optional(),
  targeting: z.unknown().optional(),
  environment: z.string().optional().default("production"),
});

router.post("/feature-flags", async (req, res) => {
  try {
    const body = flagSchema.parse(req.body);
    const flag = await prisma.featureFlag.create({ data: body });
    await createAuditLog({
      action: "FEATURE_FLAG_CREATED",
      adminEmail: getAdminEmail(req),
      entityType: "FeatureFlag",
      entityId: flag.id,
      metadata: { key: flag.key },
      ...extractAuditContext(req),
    });
    res.json({ success: true, flag });
  } catch (error: any) {
    logger.error("Feature flag create error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put("/feature-flags/:key", async (req, res) => {
  try {
    const { key } = req.params;
    const body = z
      .object({
        name: z.string().min(1).optional(),
        description: z.string().optional().nullable(),
        enabled: z.boolean().optional(),
        rollout: z.number().min(0).max(100).optional(),
        variant: z.unknown().optional(),
        targeting: z.unknown().optional(),
        environment: z.string().optional(),
      })
      .parse(req.body);

    const flag = await prisma.featureFlag.update({ where: { key }, data: body });
    await createAuditLog({
      action: "FEATURE_FLAG_UPDATED",
      adminEmail: getAdminEmail(req),
      entityType: "FeatureFlag",
      entityId: flag.id,
      metadata: { key: flag.key, enabled: flag.enabled },
      ...extractAuditContext(req),
    });
    res.json({ success: true, flag });
  } catch (error: any) {
    logger.error("Feature flag update error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete("/feature-flags/:key", async (req, res) => {
  try {
    const { key } = req.params;
    await prisma.featureFlag.delete({ where: { key } });
    await createAuditLog({
      action: "FEATURE_FLAG_DELETED",
      adminEmail: getAdminEmail(req),
      entityType: "FeatureFlag",
      metadata: { key },
      ...extractAuditContext(req),
    });
    res.json({ success: true });
  } catch (error: any) {
    logger.error("Feature flag delete error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Admin-level system configuration (site_name, support_email, etc.)
// ────────────────────────────────────────────────
const MANAGED_CONFIG_KEYS = [
  "site_name",
  "site_tagline",
  "support_email",
  "registration_open",
  "custom_css",
  "default_ai_provider",
] as const;

const configSchema = z.object({
  site_name: z.string().min(1).optional(),
  site_tagline: z.string().optional(),
  support_email: z.string().email().optional().nullable(),
  registration_open: z.boolean().optional(),
  custom_css: z.string().optional(),
  default_ai_provider: z.string().optional(),
});

router.get("/config", async (req, res) => {
  try {
    const entries = await prisma.systemConfig.findMany({
      where: { key: { in: [...MANAGED_CONFIG_KEYS, "maintenance_mode"] } },
      orderBy: { key: "asc" },
    });
    const data: Record<string, unknown> = {};
    for (const row of entries) {
      data[row.key] = row.value;
    }
    res.json({ success: true, data });
  } catch (error: any) {
    logger.error("Admin config fetch error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put("/config", async (req, res) => {
  try {
    const body = configSchema.parse(req.body);
    const adminEmail = getAdminEmail(req);
    const updatedKeys: string[] = [];

    for (const key of MANAGED_CONFIG_KEYS) {
      if (key in body) {
        await prisma.systemConfig.upsert({
          where: { key },
          create: {
            key,
            value: body[key] as any,
            description: `Admin config: ${key}`,
            updatedBy: adminEmail,
          },
          update: { value: body[key] as any, updatedBy: adminEmail },
        });
        updatedKeys.push(key);
      }
    }

    // Invalidate the maintenance cache in case maintenance_mode was changed
    try {
      const { invalidateMaintenanceCache } = await import("../../middleware/maintenance.js");
      invalidateMaintenanceCache();
    } catch { /* not critical if this fails */ }

    await createAuditLog({
      action: "ADMIN_CONFIG_UPDATED",
      adminEmail,
      entityType: "SystemConfig",
      entityId: "batch",
      metadata: { keys: updatedKeys },
      ...extractAuditContext(req),
    });

    res.json({ success: true, updatedKeys });
  } catch (error: any) {
    logger.error("Admin config update error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Feature flags — evaluate (returns map of key -> boolean)
// ────────────────────────────────────────────────
router.get("/feature-flags/evaluate", async (req, res) => {
  try {
    const env = (req.query.environment as string) || "production";
    const flags = await prisma.featureFlag.findMany({ where: { environment: env } });
    const result: Record<string, boolean> = {};
    for (const f of flags) {
      result[f.key] = f.enabled;
    }
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error("Feature flag evaluate error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// API key vault (metadata only — secrets stay in .env)
// ────────────────────────────────────────────────
router.get("/api-keys", async (req, res) => {
  try {
    const keys = await prisma.apiKeyVault.findMany({ orderBy: { service: "asc" } });
    res.json({ success: true, data: keys });
  } catch (error: any) {
    logger.error("API key vault fetch error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put("/api-keys/:service", async (req, res) => {
  try {
    const { service } = req.params;
    const body = z.object({
      label: z.string().optional(),
      envVarName: z.string().optional(),
      active: z.boolean().optional(),
    }).parse(req.body);

    const key = await prisma.apiKeyVault.upsert({
      where: { service },
      create: {
        service,
        label: body.label || service,
        envVarName: body.envVarName || service.toUpperCase() + "_API_KEY",
        active: body.active ?? true,
        updatedBy: getAdminEmail(req),
      },
      update: body,
    });

    await createAuditLog({
      action: "API_KEY_VAULT_UPDATED",
      adminEmail: getAdminEmail(req),
      entityType: "ApiKeyVault",
      entityId: service,
      metadata: { active: key.active },
      ...extractAuditContext(req),
    });

    res.json({ success: true, data: key });
  } catch (error: any) {
    logger.error("API key vault update error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// System config (non-secret key/value pairs)
// ────────────────────────────────────────────────
// POST /api/admin/platform/config  — singular key/value upsert (used by AdminSettingsPage)
router.post("/config", async (req, res) => {
  try {
    const body = z.object({ key: z.string().min(1), value: z.unknown() }).parse(req.body);
    const adminEmail = getAdminEmail(req);

    await prisma.systemConfig.upsert({
      where: { key: body.key },
      create: {
        key: body.key,
        value: body.value as any,
        description: `Admin config: ${body.key}`,
        updatedBy: adminEmail,
      },
      update: { value: body.value as any, updatedBy: adminEmail },
    });

    // Invalidate maintenance cache if that key changed
    if (body.key === "maintenance_mode") {
      try {
        const { invalidateMaintenanceCache } = await import("../../middleware/maintenance.js");
        invalidateMaintenanceCache();
      } catch { /* not critical */ }
    }

    await createAuditLog({
      action: "ADMIN_CONFIG_UPDATED",
      adminEmail,
      entityType: "SystemConfig",
      entityId: body.key,
      metadata: { value: body.value },
      ...extractAuditContext(req),
    });

    res.json({ success: true, key: body.key });
  } catch (error: any) {
    logger.error("Admin config post error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// System config (non-secret key/value pairs)
// ────────────────────────────────────────────────
router.get("/system-config", async (req, res) => {
  try {
    const entries = await prisma.systemConfig.findMany({ orderBy: { key: "asc" } });
    res.json({ success: true, data: entries });
  } catch (error: any) {
    logger.error("System config fetch error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// AI model configurations
// ────────────────────────────────────────────────
router.get("/ai-models", async (req, res) => {
  try {
    const models = await prisma.aiModelConfig.findMany({ orderBy: { priority: "asc" } });
    res.json({ success: true, data: models });
  } catch (error: any) {
    logger.error("AI models fetch error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const aiModelCreateSchema = z.object({
  provider: z.enum(["openai", "anthropic", "google"]),
  model: z.string().min(1),
  apiKeyRef: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  priority: z.number().int().optional().default(10),
});

router.post("/ai-models", async (req, res) => {
  try {
    const body = aiModelCreateSchema.parse(req.body);
    const model = await prisma.aiModelConfig.create({ data: body });
    await createAuditLog({
      action: "AI_MODEL_CREATED",
      adminEmail: getAdminEmail(req),
      entityType: "AiModelConfig",
      entityId: model.id,
      metadata: { provider: model.provider, model: model.model },
      ...extractAuditContext(req),
    });
    res.json({ success: true, model });
  } catch (error: any) {
    logger.error("AI model create error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put("/ai-models/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = z
      .object({
        provider: z.string().optional(),
        model: z.string().optional(),
        enabled: z.boolean().optional(),
        maxTokens: z.number().int().positive().optional(),
        temperature: z.number().min(0).max(2).optional(),
        priority: z.number().int().optional(),
      })
      .parse(req.body);

    const model = await prisma.aiModelConfig.update({ where: { id }, data: body });
    await createAuditLog({
      action: "AI_MODEL_UPDATED",
      adminEmail: getAdminEmail(req),
      entityType: "AiModelConfig",
      entityId: id,
      metadata: { provider: model.provider, enabled: model.enabled },
      ...extractAuditContext(req),
    });
    res.json({ success: true, model });
  } catch (error: any) {
    logger.error("AI model update error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// Returns which AI API keys are actually present in process.env.
// This is read-only — does NOT leak the key value, just whether it's set.
router.get("/ai-keys", async (req, res) => {
  try {
    const keys = {
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      GOOGLE_API_KEY: !!process.env.GOOGLE_API_KEY,
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    };
    res.json({ success: true, data: keys });
  } catch (error: any) {
    logger.error("AI keys check error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test an AI key + model by making a tiny inference call.
// Accepts either an env-var reference (apiKeyRef) OR an inline key for testing.
router.post("/ai-models/test", async (req, res) => {
  try {
    const { provider, model, apiKey, apiKeyRef } = z
      .object({
        provider: z.enum(["openai", "anthropic", "google"]),
        model: z.string().min(1),
        apiKey: z.string().optional(),
        apiKeyRef: z.string().optional(),
      })
      .parse(req.body);

    // Resolve key: explicit value beats env-var ref
    let resolvedKey: string | null = null;
    if (apiKey && apiKey.trim()) {
      resolvedKey = apiKey.trim();
    } else if (apiKeyRef && apiKeyRef.trim()) {
      resolvedKey = process.env[apiKeyRef.trim()] ?? null;
    }

    if (!resolvedKey) {
      return res.status(400).json({
        success: false,
        error:
          apiKeyRef
            ? `API key env variable "${apiKeyRef}" is not set in the backend environment. Add it to your backend .env or Render env.`
            : "No API key provided. Enter a key or choose an env-var reference.",
      });
    }

    const start = Date.now();
    let testResult: { ok: true; latencyMs: number; reply: string } | { ok: false; error: string };

    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resolvedKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Reply with the single word: ok" }],
          max_tokens: 10,
        }),
      });
      const elapsed = Date.now() - start;
      if (!r.ok) {
        const errText = await r.text();
        testResult = { ok: false, error: `OpenAI ${r.status}: ${errText.slice(0, 200)}` };
      } else {
        const data = (await r.json()) as any;
        const reply = data?.choices?.[0]?.message?.content?.trim() ?? "(no reply)";
        testResult = { ok: true, latencyMs: elapsed, reply };
      }
    } else if (provider === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": resolvedKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: "user", content: "Reply with the single word: ok" }],
        }),
      });
      const elapsed = Date.now() - start;
      if (!r.ok) {
        const errText = await r.text();
        testResult = { ok: false, error: `Anthropic ${r.status}: ${errText.slice(0, 200)}` };
      } else {
        const data = (await r.json()) as any;
        const reply =
          data?.content?.[0]?.type === "text" ? data.content[0].text.trim() : "(no reply)";
        testResult = { ok: true, latencyMs: elapsed, reply };
      }
    } else if (provider === "google") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${resolvedKey}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Reply with the single word: ok" }] }],
        }),
      });
      const elapsed = Date.now() - start;
      if (!r.ok) {
        const errText = await r.text();
        testResult = { ok: false, error: `Google ${r.status}: ${errText.slice(0, 200)}` };
      } else {
        const data = (await r.json()) as any;
        const reply =
          data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "(no reply)";
        testResult = { ok: true, latencyMs: elapsed, reply };
      }
    } else {
      return res.status(400).json({ success: false, error: "Unknown provider" });
    }

    res.json({ success: true, data: testResult });
  } catch (error: any) {
    logger.error("AI model test error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete("/ai-models/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.aiModelConfig.delete({ where: { id } });
    await createAuditLog({
      action: "AI_MODEL_DELETED",
      adminEmail: getAdminEmail(req),
      entityType: "AiModelConfig",
      entityId: id,
      ...extractAuditContext(req),
    });
    res.json({ success: true });
  } catch (error: any) {
    logger.error("AI model delete error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// CMS pages
// ────────────────────────────────────────────────
router.get("/cms-pages", async (req, res) => {
  try {
    const pages = await prisma.cmsPage.findMany({ orderBy: { created_at: "desc" } });
    res.json({ success: true, data: pages });
  } catch (error: any) {
    logger.error("CMS pages fetch error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Webhook endpoints
// ────────────────────────────────────────────────
router.post("/webhooks", async (req, res) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        url: z.string().url(),
        secret: z.string().optional().nullable(),
        active: z.boolean().optional().default(true),
        retryCount: z.number().int().optional().default(3),
        timeout: z.number().int().optional().default(30),
        events: z.array(z.string()).optional(),
      })
      .parse(req.body);

    const webhook = await prisma.webhookEndpoint.create({ data: body });
    await createAuditLog({
      action: "WEBHOOK_CREATED",
      adminEmail: getAdminEmail(req),
      entityType: "WebhookEndpoint",
      entityId: webhook.id,
      metadata: { name: webhook.name, url: webhook.url, events: webhook.events },
      ...extractAuditContext(req),
    });
    res.json({ success: true, data: webhook });
  } catch (error: any) {
    logger.error("Webhook create error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// Default webhook endpoints seeded on first load
const DEFAULT_WEBHOOKS = [
  {
    name: "Stripe Webhook",
    url: "https://api.colabwize.com/webhooks/stripe",
    events: ["invoice.payment_succeeded", "customer.subscription.updated", "customer.subscription.deleted"],
    active: true,
    retryCount: 3,
    timeout: 30,
  },
  {
    name: "Supabase Webhook",
    url: "https://api.colabwize.com/webhooks/supabase",
    events: ["auth.user.created", "auth.user.deleted", "database.rows.updated"],
    active: true,
    retryCount: 3,
    timeout: 30,
  },
];

router.get("/webhooks", async (req, res) => {
  try {
    let webhooks = await prisma.webhookEndpoint.findMany({ orderBy: { created_at: "desc" } });

    // Seed defaults on first load
    if (webhooks.length === 0) {
      for (const wh of DEFAULT_WEBHOOKS) {
        await prisma.webhookEndpoint.create({ data: wh }).catch(() => {});
      }
      webhooks = await prisma.webhookEndpoint.findMany({ orderBy: { created_at: "desc" } });
    }

    res.json({ success: true, data: webhooks });
  } catch (error: any) {
    logger.error("Webhooks fetch error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put("/webhooks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = z
      .object({
        name: z.string().optional(),
        url: z.string().url().optional(),
        active: z.boolean().optional(),
        retryCount: z.number().int().optional(),
        timeout: z.number().int().optional(),
        events: z.array(z.string()).optional(),
      })
      .parse(req.body);

    const webhook = await prisma.webhookEndpoint.update({ where: { id }, data: body });
    await createAuditLog({
      action: "WEBHOOK_UPDATED",
      adminEmail: getAdminEmail(req),
      entityType: "WebhookEndpoint",
      entityId: id,
      metadata: { name: webhook.name, active: webhook.active },
      ...extractAuditContext(req),
    });
    res.json({ success: true, webhook });
  } catch (error: any) {
    logger.error("Webhook update error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete("/webhooks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.webhookEndpoint.delete({ where: { id } });
    await createAuditLog({
      action: "WEBHOOK_DELETED",
      adminEmail: getAdminEmail(req),
      entityType: "WebhookEndpoint",
      entityId: id,
      ...extractAuditContext(req),
    });
    res.json({ success: true });
  } catch (error: any) {
    logger.error("Webhook delete error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// Fire a sample payload at the configured URL so admins can confirm the receiver works.
router.post("/webhooks/:id/test", async (req, res) => {
  try {
    const { id } = req.params;
    const webhook = await prisma.webhookEndpoint.findUnique({ where: { id } });
    if (!webhook) {
      return res.status(404).json({ success: false, error: "Webhook not found" });
    }

    const payload = {
      test: true,
      webhookId: webhook.id,
      webhookName: webhook.name,
      timestamp: new Date().toISOString(),
      event: "webhook.test",
      data: { hello: "world", sample: true },
    };

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (webhook.secret) {
      // Simple HMAC-ish signature so the receiver can verify authenticity
      const crypto = await import("crypto");
      const sig = crypto
        .createHmac("sha256", webhook.secret)
        .update(JSON.stringify(payload))
        .digest("hex");
      headers["X-ColabWize-Signature"] = sig;
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), webhook.timeout * 1000);
    let status = 0;
    let body = "";
    let ok = false;
    let errorMessage: string | null = null;

    try {
      const r = await fetch(webhook.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      status = r.status;
      body = (await r.text()).slice(0, 500);
      ok = r.ok;
      if (!r.ok) errorMessage = `Receiver returned ${r.status}`;
    } catch (err: any) {
      errorMessage = err?.name === "AbortError" ? `Timed out after ${webhook.timeout}s` : err.message;
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - start;

    await createAuditLog({
      action: "WEBHOOK_TEST_FIRED",
      adminEmail: getAdminEmail(req),
      entityType: "WebhookEndpoint",
      entityId: id,
      metadata: { ok, status, latencyMs, errorMessage },
      ...extractAuditContext(req),
    });

    res.json({
      success: true,
      data: { ok, status, latencyMs, errorMessage, responseBody: body },
    });
  } catch (error: any) {
    logger.error("Webhook test error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// CMS pages — full CRUD
// ────────────────────────────────────────────────
const cmsPageSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, digits, and dashes"),
  title: z.string().min(1),
  content: z.string(),
  metaTitle: z.string().optional().nullable(),
  metaDescription: z.string().optional().nullable(),
  status: z.enum(["draft", "published", "archived"]).optional().default("draft"),
  authorId: z.string().optional().nullable(),
});

router.post("/cms-pages", async (req, res) => {
  try {
    const body = cmsPageSchema.parse(req.body);
    const page = await prisma.cmsPage.create({ data: body });
    await createAuditLog({
      action: "CMS_PAGE_CREATED",
      adminEmail: getAdminEmail(req),
      entityType: "CmsPage",
      entityId: page.id,
      metadata: { slug: page.slug, title: page.title },
      ...extractAuditContext(req),
    });
    res.json({ success: true, data: page });
  } catch (error: any) {
    logger.error("CMS page create error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put("/cms-pages/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = cmsPageSchema.partial().parse(req.body);
    const page = await prisma.cmsPage.update({ where: { id }, data: body });
    await createAuditLog({
      action: "CMS_PAGE_UPDATED",
      adminEmail: getAdminEmail(req),
      entityType: "CmsPage",
      entityId: id,
      metadata: { slug: page.slug, status: page.status },
      ...extractAuditContext(req),
    });
    res.json({ success: true, data: page });
  } catch (error: any) {
    logger.error("CMS page update error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete("/cms-pages/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.cmsPage.delete({ where: { id } });
    await createAuditLog({
      action: "CMS_PAGE_DELETED",
      adminEmail: getAdminEmail(req),
      entityType: "CmsPage",
      entityId: id,
      ...extractAuditContext(req),
    });
    res.json({ success: true });
  } catch (error: any) {
    logger.error("CMS page delete error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
