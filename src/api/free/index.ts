import express from "express";
import paraphraseRouter from "./paraphrase";
import humanizeRouter from "./humanize";
import aiDetectRouter from "./ai-detect";

const router = express.Router();

router.use("/paraphrase", paraphraseRouter);
router.use("/humanize", humanizeRouter);
router.use("/ai-detect", aiDetectRouter);

export default router;
