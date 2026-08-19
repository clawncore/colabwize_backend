import { Router } from "express";
import { GET, POST } from "./route";

const router = Router();

router.get("/", async (req, res) => {
    try {
        const response = await GET(new Request(`http://localhost${req.url}`, {
            method: "GET",
        }));
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
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
    } catch (error) {
        res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
    }
});

export default router;
