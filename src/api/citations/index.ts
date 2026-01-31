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
import importRouter from "./import";

const router = express.Router();

import contentScanRouter from "./content-scan";

import analyzeRouter from "./analyze";
import batchAnalyzeRouter from "./batch-analyze";

// Mount sub-routers
router.use("/", contentScanRouter); // Must come before /:projectId
router.use("/", analyzeRouter); // Specific path /:p/:c/analyze, safe to put early
router.use("/", batchAnalyzeRouter);
router.use("/", missingLinkRouter);
router.use("/", auditRouter);
router.use("/", confidenceRouter);
router.use("/", searchRouter);
router.use("/", updateRouter);
router.use("/", createRouter);
router.use("/", graphRouter); // Mounts as /:projectId/graph (handled inside router)
router.use("/", gapsRouter); // Mounts as /:projectId/gaps
router.use("/", intentRouter); // Mounts as /:citationId/classify-intent and /batch-classify-intents
router.use("/", credibilityRouter); // Mounts as /credibility-score and /batch-credibility
router.use("/", consensusRouter); // Mounts as /:projectId/consensus
router.use("/import", importRouter);

export default router;
