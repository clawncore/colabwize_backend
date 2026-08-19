import express from "express";
import missingLinkRouter from "./missing-link";
import confidenceRouter from "./confidence";
import createRouter from "./create";
import searchRouter from "./search";
import auditRouter from "./audit";
import updateRouter from "./update";
import graphRouter from "./graph";
import gapsRouter from "./gaps";
import intentRouter from "./intent";
import credibilityRouter from "./credibility";
import consensusRouter from "./consensus";
import listRouter from "./list";
import importRouter from "./import";

const router = express.Router();

import contentScanRouter from "./content-scan";

import analyzeRouter from "./analyze";
import batchAnalyzeRouter from "./batch-analyze";
import forensicAuditRouter from "./forensic-audit";

// Mount sub-routers - Order matters! Static routes must come before dynamic /:projectId routes

// 1. Static Routes
router.use("/", searchRouter); // /search
router.use("/", batchAnalyzeRouter); // /batch-analyze
router.use("/", forensicAuditRouter); // /forensic-audit
router.use("/", missingLinkRouter); // /find-missing-link
router.use("/", auditRouter); // /audit
router.use("/", credibilityRouter); // /credibility-score, /batch-credibility
router.use("/", intentRouter); // /batch-classify-intents (and /:citationId/classify-intent)
router.use("/import", importRouter); // /import

// 2. Dynamic Routes (/:projectId or /:movieId or /:citationId at the root level)
router.use("/", contentScanRouter); // /:projectId/content-scan
router.use("/", analyzeRouter); // /:projectId/:citationId/analyze
router.use("/", confidenceRouter); // /confidence/:projectId
router.use("/", updateRouter); // /:projectId/:citationId
router.use("/", graphRouter); // /:projectId/graph
router.use("/", gapsRouter); // /:projectId/gaps
router.use("/", consensusRouter); // /:projectId/consensus
router.use("/", listRouter); // /:projectId
router.use("/", createRouter); // /:projectId

export default router;
