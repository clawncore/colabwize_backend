"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const platformAdmin_1 = require("../../middleware/platformAdmin");
const googleAnalyticsService_1 = require("../../services/admin/integrations/googleAnalyticsService");
const lemonSqueezyService_1 = require("../../services/admin/integrations/lemonSqueezyService");
const syncService_1 = require("../../services/admin/integrations/syncService");
const router = express_1.default.Router();
router.use(platformAdmin_1.isPlatformAdmin);
// ==========================================
// Google Analytics 4 Endpoints
// ==========================================
router.get("/google-analytics/status", (req, res) => {
    res.json({ success: true, data: googleAnalyticsService_1.gaService.getStatus() });
});
router.post("/google-analytics/test", async (req, res) => {
    try {
        const status = googleAnalyticsService_1.gaService.getStatus();
        if (!status.isConfigured) {
            return res.status(400).json({ success: false, error: "Google Analytics is not configured." });
        }
        await googleAnalyticsService_1.gaService.getTrafficOverview(); // simple call to verify connectivity
        res.json({ success: true, message: "Connection successful" });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
router.post("/google-analytics/sync", async (req, res) => {
    try {
        syncService_1.syncService.invalidateCache();
        await googleAnalyticsService_1.gaService.getTrafficOverview();
        res.json({ success: true, message: "Sync complete" });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
router.get("/google-analytics/overview", async (req, res) => {
    try {
        res.json({ success: true, data: await googleAnalyticsService_1.gaService.getTrafficOverview() });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
router.get("/google-analytics/traffic", async (req, res) => {
    try {
        res.json({ success: true, data: await googleAnalyticsService_1.gaService.getTrafficOverview() });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
router.get("/google-analytics/geography", async (req, res) => {
    try {
        res.json({ success: true, data: await googleAnalyticsService_1.gaService.getGeography() });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
router.get("/google-analytics/pages", async (req, res) => {
    try {
        res.json({ success: true, data: await googleAnalyticsService_1.gaService.getPages() });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
router.get("/google-analytics/devices", async (req, res) => {
    try {
        res.json({ success: true, data: await googleAnalyticsService_1.gaService.getDevices() });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
router.get("/google-analytics/events", async (req, res) => {
    try {
        res.json({ success: true, data: await googleAnalyticsService_1.gaService.getEvents() });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ==========================================
// Lemon Squeezy Endpoints
// ==========================================
router.get("/lemon/status", (req, res) => {
    res.json({ success: true, data: lemonSqueezyService_1.lemonSqueezyService.getStatus() });
});
router.post("/lemon/test", async (req, res) => {
    try {
        const status = lemonSqueezyService_1.lemonSqueezyService.getStatus();
        if (!status.isConfigured) {
            return res.status(400).json({ success: false, error: "Lemon Squeezy is not configured." });
        }
        await lemonSqueezyService_1.lemonSqueezyService.getOrders();
        res.json({ success: true, message: "Connection successful" });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
router.post("/lemon/sync", async (req, res) => {
    try {
        syncService_1.syncService.invalidateCache();
        await lemonSqueezyService_1.lemonSqueezyService.getOrders();
        res.json({ success: true, message: "Sync complete" });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
router.get("/lemon/orders", async (req, res) => {
    try {
        res.json({ success: true, data: await lemonSqueezyService_1.lemonSqueezyService.getOrders() });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
router.get("/lemon/customers", async (req, res) => {
    try {
        res.json({ success: true, data: await lemonSqueezyService_1.lemonSqueezyService.getCustomers() });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
router.get("/lemon/subscriptions", async (req, res) => {
    try {
        res.json({ success: true, data: await lemonSqueezyService_1.lemonSqueezyService.getSubscriptions() });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
router.get("/lemon/products", async (req, res) => {
    try {
        res.json({ success: true, data: await lemonSqueezyService_1.lemonSqueezyService.getProducts() });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
router.get("/lemon/licenses", async (req, res) => {
    try {
        res.json({ success: true, data: await lemonSqueezyService_1.lemonSqueezyService.getLicenses() });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
router.get("/lemon/revenue", async (req, res) => {
    try {
        res.json({ success: true, data: await lemonSqueezyService_1.lemonSqueezyService.getRevenueMetrics() });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.default = router;
