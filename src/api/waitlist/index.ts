import { Router } from "express";
import waitlistRouter from "./route";

const router: Router = Router();

router.use("/", waitlistRouter);

export default router;
