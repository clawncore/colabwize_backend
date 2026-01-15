import { Router } from "express";
import featureRequestRouter from "./route";

const router: Router = Router();

// Mount the feature request routes
router.use("/", featureRequestRouter);

export default router;
