"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const auth_1 = require("../../middleware/auth");
const route_1 = require("./route");
const route_2 = require("./settings/route");
const route_3 = require("./settings/reset/route");
const route_4 = require("./actions/route");
const route_5 = require("./push/route");
const route_6 = require("./bulk/route");
const route_7 = require("./test/route");
const send_test_notification_1 = require("./test/send-test-notification");
const router = (0, express_1.Router)();
// Apply authentication middleware to all notification routes
router.use(auth_1.authenticateExpressRequest);
// Get user notifications
router.get("/", async (req, res) => {
    try {
        logger_1.default.info("Notification GET route called", {
            url: req.url,
            userId: req.user?.id,
            query: req.query,
        });
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        const response = await (0, route_1.GET)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        logger_1.default.error("Notification GET failed", { error: error.message });
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Mark notification(s) as read
router.post("/read", async (req, res) => {
    try {
        logger_1.default.info("Notification read POST route called", {
            url: req.url,
            userId: req.user?.id,
            body: req.body,
        });
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            json: () => Promise.resolve(req.body),
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        const response = await (0, route_1.POST)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        logger_1.default.error("Notification read POST failed", { error: error.message });
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Create notification
router.post("/", async (req, res) => {
    try {
        logger_1.default.info("Notification POST route called", {
            url: req.url,
            userId: req.user?.id,
            body: req.body,
        });
        // Add user ID to request body
        const requestBody = {
            ...req.body,
            userId: req.user?.id,
        };
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            json: () => Promise.resolve(requestBody),
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        const response = await (0, route_1.POST)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        logger_1.default.error("Notification POST failed", { error: error.message });
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Get notification settings
router.get("/settings", async (req, res) => {
    try {
        logger_1.default.info("Notification settings GET route called", {
            url: req.url,
            userId: req.user?.id,
        });
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        const response = await (0, route_2.GET)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        logger_1.default.error("Notification settings GET failed", { error: error.message });
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Update notification settings
router.put("/settings", async (req, res) => {
    try {
        logger_1.default.info("Notification settings PUT route called", {
            url: req.url,
            userId: req.user?.id,
            body: req.body,
        });
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            json: () => Promise.resolve(req.body),
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        const response = await (0, route_2.PUT)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        logger_1.default.error("Notification settings PUT failed", { error: error.message });
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Reset notification settings
router.post("/settings/reset", async (req, res) => {
    try {
        logger_1.default.info("Notification settings reset POST route called", {
            url: req.url,
            userId: req.user?.id,
        });
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        const response = await (0, route_3.POST)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        logger_1.default.error("Notification settings reset POST failed", {
            error: error.message,
        });
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Handle notification actions (mark as read, dismiss, snooze)
router.post("/actions", async (req, res) => {
    try {
        logger_1.default.info("Notification actions POST route called", {
            url: req.url,
            userId: req.user?.id,
            body: req.body,
        });
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            json: () => Promise.resolve(req.body),
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        const response = await (0, route_4.POST)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        logger_1.default.error("Notification actions POST failed", { error: error.message });
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Register push notification token
router.post("/push/register", async (req, res) => {
    try {
        logger_1.default.info("Push notification register POST route called", {
            url: req.url,
            userId: req.user?.id,
            body: req.body,
        });
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            json: () => Promise.resolve(req.body),
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        const response = await (0, route_5.POST_REGISTER)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        logger_1.default.error("Push notification register POST failed", {
            error: error.message,
        });
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Unregister push notification token
router.post("/push/unregister", async (req, res) => {
    try {
        logger_1.default.info("Push notification unregister POST route called", {
            url: req.url,
            userId: req.user?.id,
            body: req.body,
        });
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            json: () => Promise.resolve(req.body),
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        const response = await (0, route_5.POST_UNREGISTER)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        logger_1.default.error("Push notification unregister POST failed", {
            error: error.message,
        });
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Test push notification
router.post("/push/test", async (req, res) => {
    try {
        logger_1.default.info("Push notification test POST route called", {
            url: req.url,
            userId: req.user?.id,
            body: req.body,
        });
        // Add user ID to request body
        const requestBody = {
            ...req.body,
            userId: req.user?.id,
        };
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            json: () => Promise.resolve(requestBody),
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        const response = await (0, route_5.POST_TEST)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        logger_1.default.error("Push notification test POST failed", {
            error: error.message,
        });
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Bulk operations routes
router.post("/bulk/read", async (req, res) => {
    try {
        logger_1.default.info("Bulk read notifications POST route called", {
            url: req.url,
            userId: req.user?.id,
            body: req.body,
        });
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            json: () => Promise.resolve(req.body),
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        const response = await (0, route_6.POST_READ)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        logger_1.default.error("Bulk read notifications POST failed", {
            error: error.message,
        });
        return res.status(500).json({ success: false, message: error.message });
    }
});
router.post("/bulk/delete", async (req, res) => {
    try {
        logger_1.default.info("Bulk delete notifications POST route called", {
            url: req.url,
            userId: req.user?.id,
            body: req.body,
        });
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            json: () => Promise.resolve(req.body),
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        const response = await (0, route_6.POST_DELETE)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        logger_1.default.error("Bulk delete notifications POST failed", {
            error: error.message,
        });
        return res.status(500).json({ success: false, message: error.message });
    }
});
router.post("/bulk/dismiss", async (req, res) => {
    try {
        logger_1.default.info("Bulk dismiss notifications POST route called", {
            url: req.url,
            userId: req.user?.id,
            body: req.body,
        });
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            json: () => Promise.resolve(req.body),
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        const response = await (0, route_6.POST_DISMISS)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        logger_1.default.error("Bulk dismiss notifications POST failed", {
            error: error.message,
        });
        return res.status(500).json({ success: false, message: error.message });
    }
});
router.post("/bulk/snooze", async (req, res) => {
    try {
        logger_1.default.info("Bulk snooze notifications POST route called", {
            url: req.url,
            userId: req.user?.id,
            body: req.body,
        });
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            json: () => Promise.resolve(req.body),
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        const response = await (0, route_6.POST_SNOOZE)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        logger_1.default.error("Bulk snooze notifications POST failed", {
            error: error.message,
        });
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Test notification routes
router.post("/test", async (req, res) => {
    try {
        logger_1.default.info("Test notification POST route called", {
            url: req.url,
            userId: req.user?.id,
            body: req.body,
        });
        // Add user ID to request body
        const requestBody = {
            ...req.body,
            userId: req.user?.id,
        };
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            json: () => Promise.resolve(requestBody),
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        const response = await (0, route_7.POST)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        logger_1.default.error("Test notification POST failed", { error: error.message });
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Send test notification route
router.post("/test/send", async (req, res) => {
    try {
        logger_1.default.info("Send test notification POST route called", {
            url: req.url,
            userId: req.user?.id,
            body: req.body,
        });
        // Add user ID to request body
        const requestBody = {
            ...req.body,
            userId: req.user?.id,
        };
        // Create a mock request object that matches the Edge function signature
        const fullUrl = `http://localhost:3001${req.url}`;
        // Convert express headers to Headers-like object with get method
        const headers = {
            get: (name) => req.headers[name.toLowerCase()] || null,
            has: (name) => !!req.headers[name.toLowerCase()],
        };
        const mockRequest = {
            url: fullUrl,
            headers,
            json: () => Promise.resolve(requestBody),
            user: req.user,
            auth: req.user ? { userId: req.user.id } : undefined,
        };
        // Call the function with both request and response parameters
        return await (0, send_test_notification_1.POST)(mockRequest, res);
    }
    catch (error) {
        logger_1.default.error("Send test notification POST failed", {
            error: error.message,
        });
        return res.status(500).json({ success: false, message: error.message });
    }
});
exports.default = router;
