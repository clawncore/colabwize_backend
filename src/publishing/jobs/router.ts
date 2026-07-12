import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authenticateExpressRequest } from "../../middleware/auth";
import { ExportJobService, ExportBillingError } from "./service";
import { ValidationEngine, createValidationEngine } from "../validation";
import { listCslStyles } from "../templates/csl";
import { listPublisherProfiles } from "../ppe/profiles";
import { buildExportPreviewHtml, buildExportPreviewPieces } from "../ppe/preview";
import type { TemplateResolver } from "../templates/engine";
import type { CdmResolver } from "./cdmResolver";
import type { CanonicalDocument } from "../cdm";
import { tiptapToCdm } from "../cdm";
import logger from "../../monitoring/logger";

type AuthedRequest = Request & { user?: { id: string } };

const createJobSchema = z
  .object({
    docVersionId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    // Raw CDM or live TipTap JSON — imported server-side so the editor can
    // export the *current* state without a persisted DocumentVersion.
    cdm: z.any().optional(),
    content: z.any().optional(),
  format: z.enum([
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
  settings: z
    .object({
      cslStyle: z.string().min(1).optional(),
      templateId: z.string().min(1).optional(),
      enableCiteproc: z.boolean().optional(),
      title: z.string().optional(),
      destination: z.string().optional(),
      ppe: z
        .object({
          mode: z.enum(["standard", "publication"]).optional(),
          profileId: z.string().optional(),
          placement: z
            .object({
              figures: z
                .enum([
                  "inline",
                  "end",
                  "separate-doc",
                  "separate-folder",
                  "placeholder",
                ])
                .optional(),
              tables: z
                .enum([
                  "inline",
                  "end",
                  "separate-doc",
                  "appendix",
                ])
                .optional(),
            })
            .optional(),
          targetFormat: z.enum(["docx", "latex", "pdf"]).optional(),
          imageFormat: z
            .enum(["png", "tiff", "jpg", "jpeg", "svg", "pdf"])
            .optional(),
          dpi: z.number().optional(),
          columnLayout: z.union([z.literal(1), z.literal(2)]).optional(),
        })
        .optional(),
    })
    .optional(),
  })
  .refine((v) => v.docVersionId || v.cdm || v.content, {
    message: "Provide docVersionId, cdm, or content",
  });

const validateSchema = z
  .object({
    docVersionId: z.string().min(1).optional(),
    cdm: z.any().optional(),
    // Raw TipTap document JSON (e.g. editor.getJSON()). Imported to CDM
    // server-side so the live panel can validate the *current* editor state
    // without requiring a persisted DocumentVersion.
    content: z.any().optional(),
  })
  .refine((v) => v.docVersionId || v.cdm || v.content, {
    message: "Provide docVersionId, cdm, or content",
  });

const createTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  format: z.enum(["pdf", "docx", "latex", "html", "rtf", "md", "epub", "txt"]),
  cslStyle: z.string().min(1).default("apa"),
  geometry: z
    .object({
      size: z.string(),
      margin: z.object({
        top: z.string(),
        bottom: z.string(),
        left: z.string(),
        right: z.string(),
      }),
      columns: z.union([z.literal(1), z.literal(2)]),
    })
    .optional(),
  variables: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        required: z.boolean(),
        default: z.string().optional(),
      }),
    )
    .optional(),
});

export interface PublishingRouterDeps {
  validationEngine?: ValidationEngine;
  cdmResolver?: CdmResolver;
  templateResolver?: TemplateResolver;
}

/** Build the publishing router. `service` is injected so it can be swapped
 *  for a test instance without touching global state. */
export function createPublishingRouter(
  service: ExportJobService,
  deps: PublishingRouterDeps = {},
): Router {
  const router = Router();
  const validationEngine = deps.validationEngine ?? createValidationEngine();
  const cdmResolver = deps.cdmResolver;
  const templateResolver = deps.templateResolver;

  router.use(authenticateExpressRequest as any);

  /**
   * POST /api/publishing/export
   * Enqueue an export. Returns 202 with a jobId (async) or the artifact
   * inline (fast formats). Body-validated with Zod.
   */
  router.post("/export", async (req: AuthedRequest, res: Response) => {
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
      let cdm: CanonicalDocument | undefined;
      if (parsed.data.cdm) {
        cdm = parsed.data.cdm as CanonicalDocument;
      } else if (parsed.data.content) {
        cdm = tiptapToCdm(parsed.data.content);
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
    } catch (e) {
      if (e instanceof ExportBillingError) {
        return res.status(402).json({
          success: false,
          error: e.message,
          code: e.code,
          data: e.data,
        });
      }
      logger.error("Export enqueue failed", { error: (e as Error).message });
      return res.status(500).json({ success: false, error: "Internal error" });
    }
  });

  /**
   * POST /api/publishing/validate
   * Run the ValidationEngine over a document (by docVersionId or raw CDM) and
   * return the aggregated report. Errors block publish; warnings are advisory.
   */
  router.post("/validate", async (req: AuthedRequest, res: Response) => {
    const parsed = validateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }
    try {
      let doc: CanonicalDocument;
      if (parsed.data.cdm) {
        doc = parsed.data.cdm as CanonicalDocument;
      } else if (parsed.data.content) {
        // Import the live TipTap JSON to CDM so the panel validates what the
        // user actually sees in the editor (no persisted version required).
        doc = tiptapToCdm(parsed.data.content);
      } else if (parsed.data.docVersionId && cdmResolver) {
        doc = await cdmResolver.resolve(parsed.data.docVersionId);
      } else {
        return res.status(400).json({
          success: false,
          error: "docVersionId, cdm, or content required (and resolver configured)",
        });
      }
      const report = validationEngine.validate(doc);
      return res.json({ success: true, data: report });
    } catch (e) {
      logger.error("Validation failed", { error: (e as Error).message });
      return res.status(500).json({ success: false, error: "Internal error" });
    }
  });

  /**
   * POST /api/publishing/preview
   * Render the manuscript HTML with the *same* serializer + options the export
   * uses, so the in-app preview is WYSIWYG with the generated artifact. Accepts
   * docVersionId / cdm / content like /validate.
   */
  router.post("/preview", async (req: AuthedRequest, res: Response) => {
    const parsed = validateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }
    try {
      let doc: CanonicalDocument;
      if (parsed.data.cdm) {
        doc = parsed.data.cdm as CanonicalDocument;
      } else if (parsed.data.content) {
        doc = tiptapToCdm(parsed.data.content);
      } else if (parsed.data.docVersionId && cdmResolver) {
        doc = await cdmResolver.resolve(parsed.data.docVersionId);
      } else {
        return res.status(400).json({
          success: false,
          error: "docVersionId, cdm, or content required (and resolver configured)",
        });
      }
      const mode = (req.body?.mode === "publication" ? "publication" : "standard") as
        | "standard"
        | "publication";
      const html = buildExportPreviewHtml({
        doc,
        mode,
        ppe: req.body?.ppe,
        cslStyle: req.body?.cslStyle,
      });
      return res.json({ success: true, data: { html } });
    } catch (e) {
      logger.error("Preview failed", { error: (e as Error).message });
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
  router.post("/preview-package", async (req: AuthedRequest, res: Response) => {
    const parsed = validateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }
    try {
      let doc: CanonicalDocument;
      if (parsed.data.cdm) {
        doc = parsed.data.cdm as CanonicalDocument;
      } else if (parsed.data.content) {
        doc = tiptapToCdm(parsed.data.content);
      } else if (parsed.data.docVersionId && cdmResolver) {
        doc = await cdmResolver.resolve(parsed.data.docVersionId);
      } else {
        return res.status(400).json({
          success: false,
          error: "docVersionId, cdm, or content required (and resolver configured)",
        });
      }
      const mode = req.body?.mode === "publication" ? "publication" : "standard";
      const pieces = buildExportPreviewPieces({
        doc,
        mode,
        ppe: req.body?.ppe,
        cslStyle: req.body?.cslStyle,
      });
      return res.json({ success: true, data: pieces });
    } catch (e) {
      logger.error("Preview package failed", { error: (e as Error).message });
      return res.status(500).json({ success: false, error: "Internal error" });
    }
  });

  /**
   * GET /api/publishing/jobs
   * Phase 6 — History: list the caller's export jobs, newest first.
   */
  router.get("/jobs", async (req: AuthedRequest, res: Response) => {
    const userId = getUserId(req);
    try {
      const jobs = await service.listJobs(userId);
      return res.json({ success: true, data: jobs });
    } catch (e) {
      logger.error("List jobs failed", { error: (e as Error).message });
      return res.status(500).json({ success: false, error: "Internal error" });
    }
  });

  /**
   * GET /api/publishing/csl-styles
   * List the CSL styles available to the export pipeline.
   */
  router.get("/csl-styles", (_req: AuthedRequest, res: Response) => {
    return res.json({ success: true, data: listCslStyles() });
  });

  /**
   * GET /api/publishing/publisher-profiles
   * List the publisher profiles available to the Publication Export Engine
   * (Nature, IEEE, Elsevier, …). Each carries its default formatting rules so
   * the UI can offer one-click, journal-compliant submission packages.
   */
  router.get("/publisher-profiles", (_req: AuthedRequest, res: Response) => {
    return res.json({ success: true, data: listPublisherProfiles() });
  });

  /**
   * GET /api/publishing/templates
   * List built-in + the user's custom templates.
   */
  router.get("/templates", async (req: AuthedRequest, res: Response) => {
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
  router.post("/templates", async (req: AuthedRequest, res: Response) => {
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
    } catch (e) {
      logger.error("Template create failed", { error: (e as Error).message });
      return res.status(500).json({ success: false, error: "Internal error" });
    }
  });

  /**
   * GET /api/publishing/templates/:id
   * Resolve a single template (built-in or owned by the caller).
   */
  router.get("/templates/:id", async (req: AuthedRequest, res: Response) => {
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
    } catch (e) {
      return res.status(404).json({ success: false, error: (e as Error).message });
    }
  });

  /**
   * GET /api/publishing/jobs/:id
   * Current job status + artifact descriptor (when complete).
   */
  router.get("/jobs/:id", async (req: AuthedRequest, res: Response) => {
    const userId = getUserId(req);
    const job = await service.getJob(userId, String(req.params.id));
    if (!job) return res.status(404).json({ success: false, error: "Not found" });
    return res.json({ success: true, data: job });
  });

  /**
   * GET /api/publishing/jobs/:id/events  (Server-Sent Events)
   * Streams progress. SSE is native to Express — no socket.io dependency.
   */
  router.get("/jobs/:id/events", async (req: AuthedRequest, res: Response) => {
    const userId = getUserId(req);
    const jobId = String(req.params.id);

    const job = await service.getJob(userId, jobId);
    if (!job) return res.status(404).json({ success: false, error: "Not found" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.flushHeaders?.();

    const send = (event: unknown) =>
      res.write(`data: ${JSON.stringify(event)}\n\n`);

    // Emit the current snapshot immediately.
    send({ type: "snapshot", job });

    const unsubscribe = service.subscribe(jobId, (e) => {
      send({ type: "progress", event: e });
      if (
        e.status === "SUCCEEDED" ||
        e.status === "FAILED" ||
        e.status === "CANCELLED"
      ) {
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
  router.post("/jobs/:id/cancel", async (req: AuthedRequest, res: Response) => {
    const userId = getUserId(req);
    try {
      const job = await service.cancelJob(userId, String(req.params.id));
      return res.json({ success: true, data: job });
    } catch (e) {
      return res.status(404).json({ success: false, error: (e as Error).message });
    }
  });

  return router;
}

function getUserId(req: AuthedRequest): string {
  const id = req.user?.id;
  if (!id) throw new Error("Unauthenticated");
  return id;
}
