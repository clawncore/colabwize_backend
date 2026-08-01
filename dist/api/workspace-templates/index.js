"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const route_1 = require("./route");
const router = (0, express_1.Router)();
router.get("/", async (req, res) => {
    try {
        const response = await (0, route_1.GET)(new Request(`http://localhost${req.url}`, {
            method: "GET",
        }));
        const data = await response.json();
        res.status(response.status).json(data);
    }
    catch (error) {
        res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
    }
});
router.post("/", async (req, res) => {
    try {
        const url = new URL(`http://localhost${req.originalUrl}`);
        const response = await (0, route_1.POST)(new Request(url.toString(), {
            method: "POST",
            body: JSON.stringify(req.body),
            headers: { "Content-Type": "application/json" }
        }));
        const data = await response.json();
        res.status(response.status).json(data);
    }
    catch (error) {
        res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
    }
});
exports.default = router;
