import express from "express";
import paraphraseRouter from "./paraphrase";
import humanizeRouter from "./humanize";

const router = express.Router();

router.use("/paraphrase", paraphraseRouter);
router.use("/humanize", humanizeRouter);

export default router;
