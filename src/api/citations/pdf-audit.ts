import express, { Request, Response } from "express";
import multer from "multer";
import { GrobidService } from "../../services/grobidService";
import { runUnifiedAudit, UnifiedAuditReport } from "../../audit/unified-audit";
import { BillingGateway, BillingError } from "../../billing/BillingGateway";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are accepted"));
    }
  },
});

router.post("/audit/pdf", upload.single("pdf"), async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, error: "Missing or invalid authorization header" });
    }

    const { getSupabaseClient } = await import("../../lib/supabase/client.js");
    const token = authHeader.substring(7);
    let userId: string;

    try {
      const client = await getSupabaseClient();
      if (!client) throw new Error("Supabase client missing");
      const { data: { user }, error } = await client.auth.getUser(token);
      if (error || !user) throw new Error("Invalid token");
      userId = user.id;
    } catch {
      return res.status(401).json({ success: false, error: "Invalid or expired token" });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: "No PDF file provided. Use multipart/form-data with field 'pdf'." });
    }

    const result = await GrobidService.processPDF(req.file.buffer, req.file.originalname);
    if (!result || result.references.length === 0) {
      return res.status(422).json({
        success: false,
        error: "Could not extract any references from the PDF. The document may use an unsupported format or contain only scanned images.",
      });
    }

    const projectId = req.body.projectId || `pdf-${Date.now()}`;
    const documentId = req.body.documentId || `pdf-${req.file.originalname}-${Date.now()}`;
    const style = req.body.style || "APA";
    const includeForensic = req.body.includeForensic !== "false";
    const includeSemantic = req.body.includeSemantic !== "false";

    const pdfDocState = {
      __grobidPdf: true,
      pdfBuffer: req.file.buffer,
      fileName: req.file.originalname,
    };

    let unifiedReport: UnifiedAuditReport;
    try {
      unifiedReport = await BillingGateway.withFeature(
        userId,
        "citation_audit",
        { wordCount: result.references.length * 10 },
        () => runUnifiedAudit({
          documentId,
          projectId,
          userId,
          style,
          includeForensic,
          includeSemantic,
          docState: pdfDocState,
        }),
      );
    } catch (e: any) {
      if (e instanceof BillingError) {
        const status = e.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
        return res.status(status).json({
          success: false,
          message: e.message || "Plan limit reached.",
          code: e.code,
          ...e.data,
        });
      }
      throw e;
    }

    res.status(200).json({
      success: true,
      data: {
        ...unifiedReport,
        grobidMeta: {
          documentTitle: result.documentTitle,
          documentAbstract: result.documentAbstract,
          file: req.file.originalname,
          refsExtracted: result.references.length,
        },
      },
    });

  } catch (error) {
    console.error("PDF Audit Error:", error);
    res.status(500).json({ success: false, error: "Internal PDF Audit Error" });
  }
});

router.get("/audit/pdf/status", async (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: {
      grobidAvailable: true,
      grobidEndpoint: "local",
    },
  });
});

export default router;
