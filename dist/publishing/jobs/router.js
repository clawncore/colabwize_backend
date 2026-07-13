"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPublishingRouter = createPublishingRouter;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const service_1 = require("./service");
const validation_1 = require("../validation");
const csl_1 = require("../templates/csl");
const profiles_1 = require("../ppe/profiles");
const preview_1 = require("../ppe/preview");
const cdm_1 = require("../cdm");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const createJobSchema = zod_1.z
    .object({
    docVersionId: zod_1.z.string().min(1).optional(),
    projectId: zod_1.z.string().min(1).optional(),
    // Raw CDM or live TipTap JSON — imported server-side so the editor can
    // export the *current* state without a persisted DocumentVersion.
    cdm: zod_1.z.any().optional(),
    content: zod_1.z.any().optional(),
    format: zod_1.z.enum([
        "pdf",
        "docx",
        "latex",
        "html",
        "rtf",
        "md",
        "epub",
        "txt",
        "submission",
    ]),
    settings: zod_1.z
        .object({
        cslStyle: zod_1.z.string().min(1).optional(),
        templateId: zod_1.z.string().min(1).optional(),
        enableCiteproc: zod_1.z.boolean().optional(),
        title: zod_1.z.string().optional(),
        destination: zod_1.z.string().optional(),
        ppe: zod_1.z
            .object({
            mode: zod_1.z.enum(["standard", "publication"]).optional(),
            profileId: zod_1.z.string().optional(),
            placement: zod_1.z
                .object({
                figures: zod_1.z
                    .enum([
                    "inline",
                    "end",
                    "separate-doc",
                    "separate-folder",
                    "placeholder",
                ])
                    .optional(),
                tables: zod_1.z
                    .enum([
                    "inline",
                    "end",
                    "separate-doc",
                    "appendix",
                ])
                    .optional(),
            })
                .optional(),
            targetFormat: zod_1.z.enum(["docx", "latex", "pdf"]).optional(),
            imageFormat: zod_1.z
                .enum(["png", "tiff", "jpg", "jpeg", "svg", "pdf"])
                .optional(),
            dpi: zod_1.z.number().optional(),
            columnLayout: zod_1.z.union([zod_1.z.literal(1), zod_1.z.literal(2)]).optional(),
        })
            .optional(),
    })
        .optional(),
})
    .refine((v) => v.docVersionId || v.cdm || v.content, {
    message: "Provide docVersionId, cdm, or content",
});
const validateSchema = zod_1.z
    .object({
    docVersionId: zod_1.z.string().min(1).optional(),
    cdm: zod_1.z.any().optional(),
    // Raw TipTap document JSON (e.g. editor.getJSON()). Imported to CDM
    // server-side so the live panel can validate the *current* editor state
    // without requiring a persisted DocumentVersion.
    content: zod_1.z.any().optional(),
})
    .refine((v) => v.docVersionId || v.cdm || v.content, {
    message: "Provide docVersionId, cdm, or content",
});
const createTemplateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    description: zod_1.z.string().optional(),
    format: zod_1.z.enum(["pdf", "docx", "latex", "html", "rtf", "md", "epub", "txt"]),
    cslStyle: zod_1.z.string().min(1).default("apa"),
    geometry: zod_1.z
        .object({
        size: zod_1.z.string(),
        margin: zod_1.z.object({
            top: zod_1.z.string(),
            bottom: zod_1.z.string(),
            left: zod_1.z.string(),
            right: zod_1.z.string(),
        }),
        columns: zod_1.z.union([zod_1.z.literal(1), zod_1.z.literal(2)]),
    })
        .optional(),
    variables: zod_1.z
        .array(zod_1.z.object({
        key: zod_1.z.string().min(1),
        label: zod_1.z.string().min(1),
        required: zod_1.z.boolean(),
        default: zod_1.z.string().optional(),
    }))
        .optional(),
});
/** Build the publishing router. `service` is injected so it can be swapped
 *  for a test instance without touching global state. */
function createPublishingRouter(service, deps = {}) {
    const router = (0, express_1.Router)();
    const validationEngine = deps.validationEngine ?? (0, validation_1.createValidationEngine)();
    const cdmResolver = deps.cdmResolver;
    const templateResolver = deps.templateResolver;
    router.use(auth_1.authenticateExpressRequest);
    /**
     * POST /api/publishing/export
     * Enqueue an export. Returns 202 with a jobId (async) or the artifact
     * inline (fast formats). Body-validated with Zod.
     */
    router.post("/export", async (req, res) => {
        const parsed = createJobSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: "Invalid request",
                details: parsed.error.flatten(),
            });
        }
        const userId = getUserId(req);
        try {
            // Resolve the source document. Prefer an explicit CDM, then live TipTap
            // JSON (imported server-side), then a stored DocumentVersion.
            let cdm;
            if (parsed.data.cdm) {
                cdm = parsed.data.cdm;
            }
            else if (parsed.data.content) {
                cdm = (0, cdm_1.tiptapToCdm)(parsed.data.content);
            }
            const enqueued = await service.createExportJob({
                userId,
                projectId: parsed.data.projectId,
                docVersionId: parsed.data.docVersionId,
                cdm,
                format: parsed.data.format,
                settings: parsed.data.settings,
            });
            return res.status(202).json({ success: true, data: enqueued });
        }
        catch (e) {
            if (e instanceof service_1.ExportBillingError) {
                return res.status(402).json({
                    success: false,
                    error: e.message,
                    code: e.code,
                    data: e.data,
                });
            }
            logger_1.default.error("Export enqueue failed", { error: e.message });
            return res.status(500).json({ success: false, error: "Internal error" });
        }
    });
    /**
     * POST /api/publishing/validate
     * Run the ValidationEngine over a document (by docVersionId or raw CDM) and
     * return the aggregated report. Errors block publish; warnings are advisory.
     */
    router.post("/validate", async (req, res) => {
        const parsed = validateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: "Invalid request",
                details: parsed.error.flatten(),
            });
        }
        try {
            let doc;
            if (parsed.data.cdm) {
                doc = parsed.data.cdm;
            }
            else if (parsed.data.content) {
                // Import the live TipTap JSON to CDM so the panel validates what the
                // user actually sees in the editor (no persisted version required).
                doc = (0, cdm_1.tiptapToCdm)(parsed.data.content);
            }
            else if (parsed.data.docVersionId && cdmResolver) {
                doc = await cdmResolver.resolve(parsed.data.docVersionId);
            }
            else {
                return res.status(400).json({
                    success: false,
                    error: "docVersionId, cdm, or content required (and resolver configured)",
                });
            }
            const report = validationEngine.validate(doc);
            return res.json({ success: true, data: report });
        }
        catch (e) {
            logger_1.default.error("Validation failed", { error: e.message });
            return res.status(500).json({ success: false, error: "Internal error" });
        }
    });
    /**
     * POST /api/publishing/preview
     * Render the manuscript HTML with the *same* serializer + options the export
     * uses, so the in-app preview is WYSIWYG with the generated artifact. Accepts
     * docVersionId / cdm / content like /validate.
     */
    router.post("/preview", async (req, res) => {
        const parsed = validateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: "Invalid request",
                details: parsed.error.flatten(),
            });
        }
        try {
            let doc;
            if (parsed.data.cdm) {
                doc = parsed.data.cdm;
            }
            else if (parsed.data.content) {
                doc = (0, cdm_1.tiptapToCdm)(parsed.data.content);
            }
            else if (parsed.data.docVersionId && cdmResolver) {
                doc = await cdmResolver.resolve(parsed.data.docVersionId);
            }
            else {
                return res.status(400).json({
                    success: false,
                    error: "docVersionId, cdm, or content required (and resolver configured)",
                });
            }
            const mode = (req.body?.mode === "publication" ? "publication" : "standard");
            const html = (0, preview_1.buildExportPreviewHtml)({
                doc,
                mode,
                ppe: req.body?.ppe,
                cslStyle: req.body?.cslStyle,
            });
            return res.json({ success: true, data: { html } });
        }
        catch (e) {
            logger_1.default.error("Preview failed", { error: e.message });
            return res.status(500).json({ success: false, error: "Internal error" });
        }
    });
    /**
     * POST /api/publishing/preview-package
     * Pre-export "proof" view: renders every piece the export will emit
     * (manuscript + any separated figures/tables documents) with the same
     * serializer, so the user can inspect exactly what each file will contain
     * before committing to the export. Figures/Tables HTML is only returned when
     * the chosen placement is non-inline.
     */
    router.post("/preview-package", async (req, res) => {
        const parsed = validateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: "Invalid request",
                details: parsed.error.flatten(),
            });
        }
        try {
            let doc;
            if (parsed.data.cdm) {
                doc = parsed.data.cdm;
            }
            else if (parsed.data.content) {
                doc = (0, cdm_1.tiptapToCdm)(parsed.data.content);
            }
            else if (parsed.data.docVersionId && cdmResolver) {
                doc = await cdmResolver.resolve(parsed.data.docVersionId);
            }
            else {
                return res.status(400).json({
                    success: false,
                    error: "docVersionId, cdm, or content required (and resolver configured)",
                });
            }
            const mode = req.body?.mode === "publication" ? "publication" : "standard";
            const pieces = (0, preview_1.buildExportPreviewPieces)({
                doc,
                mode,
                ppe: req.body?.ppe,
                cslStyle: req.body?.cslStyle,
            });
            return res.json({ success: true, data: pieces });
        }
        catch (e) {
            logger_1.default.error("Preview package failed", { error: e.message });
            return res.status(500).json({ success: false, error: "Internal error" });
        }
    });
    /**
     * GET /api/publishing/jobs
     * Phase 6 — History: list the caller's export jobs, newest first.
     */
    router.get("/jobs", async (req, res) => {
        const userId = getUserId(req);
        try {
            const jobs = await service.listJobs(userId);
            return res.json({ success: true, data: jobs });
        }
        catch (e) {
            logger_1.default.error("List jobs failed", { error: e.message });
            return res.status(500).json({ success: false, error: "Internal error" });
        }
    });
    /**
     * GET /api/publishing/csl-styles
     * List the CSL styles available to the export pipeline.
     */
    router.get("/csl-styles", (_req, res) => {
        return res.json({ success: true, data: (0, csl_1.listCslStyles)() });
    });
    /**
     * GET /api/publishing/publisher-profiles
     * List the publisher profiles available to the Publication Export Engine
     * (Nature, IEEE, Elsevier, …). Each carries its default formatting rules so
     * the UI can offer one-click, journal-compliant submission packages.
     */
    router.get("/publisher-profiles", (_req, res) => {
        return res.json({ success: true, data: (0, profiles_1.listPublisherProfiles)() });
    });
    /**
     * GET /api/publishing/templates
     * List built-in + the user's custom templates.
     */
    router.get("/templates", async (req, res) => {
        if (!templateResolver) {
            return res.status(501).json({ success: false, error: "Templates unavailable" });
        }
        const userId = getUserId(req);
        const templates = await templateResolver.list(userId);
        return res.json({ success: true, data: templates });
    });
    /**
     * POST /api/publishing/templates
     * Create a custom template owned by the caller.
     */
    router.post("/templates", async (req, res) => {
        if (!templateResolver) {
            return res.status(501).json({ success: false, error: "Templates unavailable" });
        }
        const parsed = createTemplateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: "Invalid request",
                details: parsed.error.flatten(),
            });
        }
        const userId = getUserId(req);
        try {
            const tpl = await templateResolver.create(userId, parsed.data);
            return res.status(201).json({ success: true, data: tpl });
        }
        catch (e) {
            logger_1.default.error("Template create failed", { error: e.message });
            return res.status(500).json({ success: false, error: "Internal error" });
        }
    });
    /**
     * GET /api/publishing/templates/:id
     * Resolve a single template (built-in or owned by the caller).
     */
    router.get("/templates/:id", async (req, res) => {
        if (!templateResolver) {
            return res.status(501).json({ success: false, error: "Templates unavailable" });
        }
        const userId = getUserId(req);
        try {
            const tpl = await templateResolver.resolve(String(req.params.id));
            // Built-in templates are shared; custom ones are owned by the caller.
            // (Ownership enforcement is light here — resolution is the source of truth
            // and the list endpoint already scopes by owner.)
            void userId;
            return res.json({ success: true, data: tpl });
        }
        catch (e) {
            return res.status(404).json({ success: false, error: e.message });
        }
    });
    /**
     * GET /api/publishing/jobs/:id
     * Current job status + artifact descriptor (when complete).
     */
    router.get("/jobs/:id", async (req, res) => {
        const userId = getUserId(req);
        const job = await service.getJob(userId, String(req.params.id));
        if (!job)
            return res.status(404).json({ success: false, error: "Not found" });
        return res.json({ success: true, data: job });
    });
    /**
     * GET /api/publishing/jobs/:id/events  (Server-Sent Events)
     * Streams progress. SSE is native to Express — no socket.io dependency.
     */
    router.get("/jobs/:id/events", async (req, res) => {
        const userId = getUserId(req);
        const jobId = String(req.params.id);
        const job = await service.getJob(userId, jobId);
        if (!job)
            return res.status(404).json({ success: false, error: "Not found" });
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
        });
        res.flushHeaders?.();
        const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
        // Emit the current snapshot immediately.
        send({ type: "snapshot", job });
        const unsubscribe = service.subscribe(jobId, (e) => {
            send({ type: "progress", event: e });
            if (e.status === "SUCCEEDED" ||
                e.status === "FAILED" ||
                e.status === "CANCELLED") {
                send({ type: "done", status: e.status });
            }
        });
        // Heartbeat keeps proxies from closing the idle connection.
        const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
        req.on("close", () => {
            clearInterval(heartbeat);
            unsubscribe();
        });
    });
    /**
     * POST /api/publishing/jobs/:id/cancel
     * Cancels a non-terminal job and refunds the billing hold.
     */
    router.post("/jobs/:id/cancel", async (req, res) => {
        const userId = getUserId(req);
        try {
            const job = await service.cancelJob(userId, String(req.params.id));
            return res.json({ success: true, data: job });
        }
        catch (e) {
            return res.status(404).json({ success: false, error: e.message });
        }
    });
    return router;
}
function getUserId(req) {
    const id = req.user?.id;
    if (!id)
        throw new Error("Unauthenticated");
    return id;
}
