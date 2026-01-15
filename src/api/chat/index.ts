import express from "express";
import chatRouter from "./chat";

const router = express.Router();

router.use("/", chatRouter);

export default router;
