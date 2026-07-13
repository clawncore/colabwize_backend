"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const route_1 = require("./route");
const version_route_1 = require("./version-route");
const router = express_1.default.Router();
// Get project content
router.get("/", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            url: req.url,
            user: { id: req.user?.id },
        };
        const response = await (0, route_1.GET)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Save project content
router.put("/", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            json: async () => req.body,
            user: { id: req.user?.id },
        };
        const response = await (0, route_1.PUT)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Get document versions/history
router.get("/versions", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            url: req.url,
            user: { id: req.user?.id },
        };
        const response = await (0, route_1.GET_VERSIONS)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Create document version
router.post("/versions", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            json: async () => req.body,
            user: { id: req.user?.id },
        };
        const response = await (0, version_route_1.POST_VERSION)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Add comment to document
router.post("/comments", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            json: async () => req.body,
            user: { id: req.user?.id },
        };
        const response = await (0, route_1.POST_COMMENT)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Get comments for document
router.get("/comments", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            url: req.url,
            user: { id: req.user?.id },
        };
        const response = await (0, route_1.GET_COMMENTS)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Restore document version
router.post("/restore-version", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            json: async () => req.body,
            user: { id: req.user?.id },
        };
        const response = await (0, route_1.POST_RESTORE_VERSION)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Delete document version
router.delete("/versions/:versionId", async (req, res) => {
    try {
        const mockRequest = {
            json: async () => ({
                projectId: req.query.projectId,
                versionId: req.params.versionId,
            }),
            user: { id: req.user?.id },
        };
        const response = await (0, route_1.DELETE_VERSION)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
router.get("/settings", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            url: req.url,
            user: { id: req.user?.id },
        };
        const response = await (0, route_1.GET_SETTINGS)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Update editor settings
router.put("/settings", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            json: async () => req.body,
            user: { id: req.user?.id },
        };
        const response = await (0, route_1.PUT_SETTINGS)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Get editor analytics
router.get("/analytics", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            url: req.url,
            user: { id: req.user?.id },
        };
        const response = await (0, route_1.GET_ANALYTICS)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Handle beacon draft
router.post("/beacon-draft", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            json: async () => req.body,
            user: { id: req.user?.id },
        };
        const response = await (0, route_1.POST_BEACON_DRAFT)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Import document
router.post("/import", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            json: async () => req.body,
            user: { id: req.user?.id },
        };
        const response = await (0, route_1.POST_IMPORT)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
exports.default = router;
