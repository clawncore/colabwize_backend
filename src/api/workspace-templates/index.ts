import { Router } from "express";
import logger from "../../monitoring/logger";
import { GET, POST } from "./route";

const router = Router();

router.get("/", async (req, res) => {
    try {
        const response = await GET(new Request(`http://localhost${req.url}`, {
            method: "GET",
        }));
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error: any) {
        logger.error("Workspace templates GET failed", { error: error.message });
        res.status(500).json({ success: false, message: "Failed to load workspace templates." });
    }
});

router.post("/", async (req, res) => {
    try {
        const url = new URL(`http://localhost${req.originalUrl}`);
        const response = await POST(new Request(url.toString(), {
            method: "POST",
            body: JSON.stringify(req.body),
            headers: { "Content-Type": "application/json" }
        }));
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error: any) {
        logger.error("Workspace templates POST failed", { error: error.message });
        res.status(500).json({ success: false, message: "Failed to load workspace templates." });
    }
});

export default router;
