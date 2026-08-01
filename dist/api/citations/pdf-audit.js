"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const grobidService_1 = require("../../services/grobidService");
const unified_audit_1 = require("../../audit/unified-audit");
const BillingGateway_1 = require("../../billing/BillingGateway");
const router = express_1.default.Router();
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024,
    },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === "application/pdf" || file.originalname.endsWith(".pdf")) {
            cb(null, true);
        }
        else {
            cb(new Error("Only PDF files are accepted"));
        }
    },
});
router.post("/audit/pdf", upload.single("pdf"), async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ success: false, error: "Missing or invalid authorization header" });
        }
        const { getSupabaseClient } = await import("../../lib/supabase/client.js");
        const token = authHeader.substring(7);
        let userId;
        try {
            const client = await getSupabaseClient();
            if (!client)
                throw new Error("Supabase client missing");
            const { data: { user }, error } = await client.auth.getUser(token);
            if (error || !user)
                throw new Error("Invalid token");
            userId = user.id;
        }
        catch {
            return res.status(401).json({ success: false, error: "Invalid or expired token" });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, error: "No PDF file provided. Use multipart/form-data with field 'pdf'." });
        }
        const result = await grobidService_1.GrobidService.processPDF(req.file.buffer, req.file.originalname);
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
        let unifiedReport;
        try {
            unifiedReport = await BillingGateway_1.BillingGateway.withFeature(userId, "citation_audit", { wordCount: result.references.length * 10 }, () => (0, unified_audit_1.runUnifiedAudit)({
                documentId,
                projectId,
                userId,
                style,
                includeForensic,
                includeSemantic,
                docState: pdfDocState,
            }));
        }
        catch (e) {
            if (e instanceof BillingGateway_1.BillingError) {
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
    }
    catch (error) {
        console.error("PDF Audit Error:", error);
        res.status(500).json({ success: false, error: "Internal PDF Audit Error" });
    }
});
router.get("/audit/pdf/status", async (_req, res) => {
    res.status(200).json({
        success: true,
        data: {
            grobidAvailable: true,
            grobidEndpoint: "local",
        },
    });
});
exports.default = router;
