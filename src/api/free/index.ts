import express from "express";
import paraphraseRouter from "./paraphrase";
import humanizeRouter from "./humanize";
import aiDetectRouter from "./ai-detect";
import plagiarismCheckRouter from "./plagiarism-check";

const router = express.Router();

router.use("/", paraphraseRouter);
router.use("/", humanizeRouter);
router.use("/", aiDetectRouter);
router.use("/", plagiarismCheckRouter);

export default router;
