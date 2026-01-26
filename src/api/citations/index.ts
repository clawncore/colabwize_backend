import express from "express";
import missingLinkRouter from "./missing-link";
import confidenceRouter from "./confidence";
import createRouter from "./create";
import searchRouter from "./search";
import auditRouter from "./audit";
import updateRouter from "./update";

const router = express.Router();

import contentScanRouter from "./content-scan";

import analyzeRouter from "./analyze";

// Mount sub-routers
router.use("/", contentScanRouter); // Must come before /:projectId
router.use("/", analyzeRouter); // Specific path /:p/:c/analyze, safe to put early
router.use("/", missingLinkRouter);
router.use("/", auditRouter);
router.use("/", confidenceRouter);
router.use("/", searchRouter);
router.use("/", updateRouter);
router.use("/", createRouter); // Generic /:projectId match

export default router;
