"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const platformAdmin_1 = require("../../middleware/platformAdmin");
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const auditLogService_1 = require("../../services/admin/auditLogService");
const router = express_1.default.Router();
router.use(platformAdmin_1.isPlatformAdmin);
// ────────────────────────────────────────────────
// Feature flags
// ────────────────────────────────────────────────
router.get("/feature-flags", async (req, res) => {
    try {
        const flags = await prisma_1.prisma.featureFlag.findMany({ orderBy: { created_at: "desc" } });
        res.json({ success: true, data: flags });
    }
    catch (error) {
        logger_1.default.error("Feature flags fetch error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
const flagSchema = zod_1.z.object({
    key: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1),
    description: zod_1.z.string().optional().nullable(),
    enabled: zod_1.z.boolean().optional().default(false),
    rollout: zod_1.z.number().min(0).max(100).optional().default(0),
    variant: zod_1.z.unknown().optional(),
    targeting: zod_1.z.unknown().optional(),
    environment: zod_1.z.string().optional().default("production"),
});
router.post("/feature-flags", async (req, res) => {
    try {
        const body = flagSchema.parse(req.body);
        const flag = await prisma_1.prisma.featureFlag.create({ data: body });
        await (0, auditLogService_1.createAuditLog)({
            action: "FEATURE_FLAG_CREATED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "FeatureFlag",
            entityId: flag.id,
            metadata: { key: flag.key },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true, flag });
    }
    catch (error) {
        logger_1.default.error("Feature flag create error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
router.put("/feature-flags/:key", async (req, res) => {
    try {
        const { key } = req.params;
        const body = zod_1.z
            .object({
            name: zod_1.z.string().min(1).optional(),
            description: zod_1.z.string().optional().nullable(),
            enabled: zod_1.z.boolean().optional(),
            rollout: zod_1.z.number().min(0).max(100).optional(),
            variant: zod_1.z.unknown().optional(),
            targeting: zod_1.z.unknown().optional(),
            environment: zod_1.z.string().optional(),
        })
            .parse(req.body);
        const flag = await prisma_1.prisma.featureFlag.update({ where: { key }, data: body });
        await (0, auditLogService_1.createAuditLog)({
            action: "FEATURE_FLAG_UPDATED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "FeatureFlag",
            entityId: flag.id,
            metadata: { key: flag.key, enabled: flag.enabled },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true, flag });
    }
    catch (error) {
        logger_1.default.error("Feature flag update error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
router.delete("/feature-flags/:key", async (req, res) => {
    try {
        const { key } = req.params;
        await prisma_1.prisma.featureFlag.delete({ where: { key } });
        await (0, auditLogService_1.createAuditLog)({
            action: "FEATURE_FLAG_DELETED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "FeatureFlag",
            metadata: { key },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("Feature flag delete error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
// ────────────────────────────────────────────────
// System config (non-secret key/value pairs)
// ────────────────────────────────────────────────
router.get("/system-config", async (req, res) => {
    try {
        const entries = await prisma_1.prisma.systemConfig.findMany({ orderBy: { key: "asc" } });
        res.json({ success: true, data: entries });
    }
    catch (error) {
        logger_1.default.error("System config fetch error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ────────────────────────────────────────────────
// AI model configurations
// ────────────────────────────────────────────────
router.get("/ai-models", async (req, res) => {
    try {
        const models = await prisma_1.prisma.aiModelConfig.findMany({ orderBy: { priority: "asc" } });
        res.json({ success: true, data: models });
    }
    catch (error) {
        logger_1.default.error("AI models fetch error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
router.put("/ai-models/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const body = zod_1.z
            .object({
            provider: zod_1.z.string().optional(),
            model: zod_1.z.string().optional(),
            enabled: zod_1.z.boolean().optional(),
            maxTokens: zod_1.z.number().int().positive().optional(),
            temperature: zod_1.z.number().min(0).max(2).optional(),
            priority: zod_1.z.number().int().optional(),
        })
            .parse(req.body);
        const model = await prisma_1.prisma.aiModelConfig.update({ where: { id }, data: body });
        await (0, auditLogService_1.createAuditLog)({
            action: "AI_MODEL_UPDATED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "AiModelConfig",
            entityId: id,
            metadata: { provider: model.provider, enabled: model.enabled },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true, model });
    }
    catch (error) {
        logger_1.default.error("AI model update error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
router.delete("/ai-models/:id", async (req, res) => {
    try {
        const { id } = req.params;
        await prisma_1.prisma.aiModelConfig.delete({ where: { id } });
        await (0, auditLogService_1.createAuditLog)({
            action: "AI_MODEL_DELETED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "AiModelConfig",
            entityId: id,
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("AI model delete error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
// ────────────────────────────────────────────────
// CMS pages
// ────────────────────────────────────────────────
router.get("/cms-pages", async (req, res) => {
    try {
        const pages = await prisma_1.prisma.cmsPage.findMany({ orderBy: { created_at: "desc" } });
        res.json({ success: true, data: pages });
    }
    catch (error) {
        logger_1.default.error("CMS pages fetch error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ────────────────────────────────────────────────
// Webhook endpoints
// ────────────────────────────────────────────────
router.get("/webhooks", async (req, res) => {
    try {
        const webhooks = await prisma_1.prisma.webhookEndpoint.findMany({ orderBy: { created_at: "desc" } });
        res.json({ success: true, data: webhooks });
    }
    catch (error) {
        logger_1.default.error("Webhooks fetch error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
router.put("/webhooks/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const body = zod_1.z
            .object({
            name: zod_1.z.string().optional(),
            url: zod_1.z.string().url().optional(),
            active: zod_1.z.boolean().optional(),
            retryCount: zod_1.z.number().int().optional(),
            timeout: zod_1.z.number().int().optional(),
            events: zod_1.z.array(zod_1.z.string()).optional(),
        })
            .parse(req.body);
        const webhook = await prisma_1.prisma.webhookEndpoint.update({ where: { id }, data: body });
        await (0, auditLogService_1.createAuditLog)({
            action: "WEBHOOK_UPDATED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "WebhookEndpoint",
            entityId: id,
            metadata: { name: webhook.name, active: webhook.active },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true, webhook });
    }
    catch (error) {
        logger_1.default.error("Webhook update error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
router.delete("/webhooks/:id", async (req, res) => {
    try {
        const { id } = req.params;
        await prisma_1.prisma.webhookEndpoint.delete({ where: { id } });
        await (0, auditLogService_1.createAuditLog)({
            action: "WEBHOOK_DELETED",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "WebhookEndpoint",
            entityId: id,
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("Webhook delete error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
exports.default = router;
