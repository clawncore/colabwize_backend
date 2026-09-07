import express from "express";
import paraphraseRouter from "./paraphrase";
import humanizeRouter from "./humanize";
import aiDetectRouter from "./ai-detect";

const router = express.Router();

router.use("/", paraphraseRouter);
router.use("/", humanizeRouter);
router.use("/", aiDetectRouter);

export default router;
