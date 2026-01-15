import { Router } from "express";
import supportTicketRouter from "./route";

const router: Router = Router();

// Mount the support ticket routes
router.use("/", supportTicketRouter);

export default router;
