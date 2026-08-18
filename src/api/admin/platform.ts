import express, { Router } from "express";
import { z } from "zod";
import { isPlatformAdmin } from "../../middleware/platformAdmin";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { createAuditLog, extractAuditContext, getAdminEmail } from "../../services/admin/auditLogService";

const router: Router = express.Router();

router.use(isPlatformAdmin);

// ────────────────────────────────────────────────
// Feature flags
// ────────────────────────────────────────────────
router.get("/feature-flags", async (req, res) => {
  try {
    const flags = await prisma.featureFlag.findMany({ orderBy: { created_at: "desc" } });
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
router.get("/webhooks", async (req, res) => {
  try {
    const webhooks = await prisma.webhookEndpoint.findMany({ orderBy: { created_at: "desc" } });
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

export default router;
