"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const route_1 = require("./route");
const router = express_1.default.Router();
// Get templates (with optional type filter)
router.get("/", async (req, res) => {
    try {
        // Create a mock request object that matches the Next.js API route signature
        // Create a mock request object that matches the Next.js API route signature
        const url = new URL(`http://localhost${req.url}`);
        // Create a mock NextRequest object
        const mockRequest = {
            url: url.toString(),
            json: async () => ({}),
        };
        const response = await (0, route_1.GET)(mockRequest);
        const data = await response.json();
        return res.status(response.status || 200).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Get template by type
router.get("/type/:type", async (req, res) => {
    try {
        // Create a mock request object that matches the Next.js API route signature
        const { type } = req.params;
        const url = new URL(`http://localhost${req.url}`);
        // Create a mock NextRequest object
        const mockRequest = {
            url: url.toString(),
            json: async () => ({}),
        };
        const response = await (0, route_1.GET)(mockRequest);
        const data = await response.json();
        return res.status(response.status || 200).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Create a new template
router.post("/", async (req, res) => {
    try {
        // Create a mock request object that matches the Next.js API route signature
        const mockRequest = {
            json: async () => req.body,
            url: `http://localhost${req.url}`,
        };
        const response = await (0, route_1.POST)(mockRequest);
        const data = await response.json();
        return res.status(response.status || 200).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Update a template
router.put("/", async (req, res) => {
    try {
        // Create a mock request object that matches the Next.js API route signature
        const mockRequest = {
            json: async () => req.body,
            url: `http://localhost${req.url}`,
        };
        const response = await (0, route_1.PUT)(mockRequest);
        const data = await response.json();
        return res.status(response.status || 200).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Delete a template
router.delete("/", async (req, res) => {
    try {
        // Create a mock request object that matches the Next.js API route signature
        // Create a mock request object that matches the Next.js API route signature
        const url = new URL(`http://localhost${req.url}`);
        const mockRequest = {
            url: url.toString(),
            json: async () => ({}),
        };
        const response = await (0, route_1.DELETE)(mockRequest);
        const data = await response.json();
        return res.status(response.status || 200).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
exports.default = router;
