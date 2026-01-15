import express from "express";
import missingLinkRouter from "./missing-link";
import confidenceRouter from "./confidence";
import createRouter from "./create";
import searchRouter from "./search";

const router = express.Router();

import contentScanRouter from "./content-scan";

// Mount sub-routers
// Mount sub-routers
router.use("/", contentScanRouter); // Must come before /:projectId
router.use("/", missingLinkRouter);
router.use("/", confidenceRouter);
router.use("/", searchRouter);
router.use("/", createRouter); // Generic /:projectId match

export default router;
