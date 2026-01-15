import { Router } from "express";
import uploadRoutes from "./upload";
import serveRoutes from "./serve";
import fileProcessingRoutes from "./fileProcessing";

const router = Router();

// Mount file upload routes
router.use("/", uploadRoutes);

// Mount file serving routes
router.use("/", serveRoutes);

// Mount file processing routes
router.use("/process", fileProcessingRoutes);

export default router;
