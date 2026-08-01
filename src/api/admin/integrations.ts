import express, { Router } from "express";
import { isPlatformAdmin } from "../../middleware/platformAdmin";
import { gaService } from "../../services/admin/integrations/googleAnalyticsService";
import { lemonSqueezyService } from "../../services/admin/integrations/lemonSqueezyService";
import { syncService } from "../../services/admin/integrations/syncService";
import logger from "../../monitoring/logger";

const router: Router = express.Router();

router.use(isPlatformAdmin);

// ==========================================
// Google Analytics 4 Endpoints
// ==========================================

router.get("/google-analytics/status", (req, res) => {
  res.json({ success: true, data: gaService.getStatus() });
});

router.post("/google-analytics/test", async (req, res) => {
  try {
    const status = gaService.getStatus();
    if (!status.isConfigured) {
      return res.status(400).json({ success: false, error: "Google Analytics is not configured." });
    }
    await gaService.getTrafficOverview(); // simple call to verify connectivity
    res.json({ success: true, message: "Connection successful" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/google-analytics/sync", async (req, res) => {
  try {
    syncService.invalidateCache();
    await gaService.getTrafficOverview();
    res.json({ success: true, message: "Sync complete" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/google-analytics/overview", async (req, res) => {
  try { res.json({ success: true, data: await gaService.getTrafficOverview() }); } 
  catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/google-analytics/traffic", async (req, res) => {
  try { res.json({ success: true, data: await gaService.getTrafficOverview() }); } 
  catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/google-analytics/geography", async (req, res) => {
  try { res.json({ success: true, data: await gaService.getGeography() }); } 
  catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/google-analytics/pages", async (req, res) => {
  try { res.json({ success: true, data: await gaService.getPages() }); } 
  catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/google-analytics/devices", async (req, res) => {
  try { res.json({ success: true, data: await gaService.getDevices() }); } 
  catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/google-analytics/events", async (req, res) => {
  try { res.json({ success: true, data: await gaService.getEvents() }); } 
  catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});


// ==========================================
// Lemon Squeezy Endpoints
// ==========================================

router.get("/lemon/status", (req, res) => {
  res.json({ success: true, data: lemonSqueezyService.getStatus() });
});

router.post("/lemon/test", async (req, res) => {
  try {
    const status = lemonSqueezyService.getStatus();
    if (!status.isConfigured) {
      return res.status(400).json({ success: false, error: "Lemon Squeezy is not configured." });
    }
    await lemonSqueezyService.getOrders();
    res.json({ success: true, message: "Connection successful" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/lemon/sync", async (req, res) => {
  try {
    syncService.invalidateCache();
    await lemonSqueezyService.getOrders();
    res.json({ success: true, message: "Sync complete" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/lemon/orders", async (req, res) => {
  try { res.json({ success: true, data: await lemonSqueezyService.getOrders() }); } 
  catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/lemon/customers", async (req, res) => {
  try { res.json({ success: true, data: await lemonSqueezyService.getCustomers() }); } 
  catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/lemon/subscriptions", async (req, res) => {
  try { res.json({ success: true, data: await lemonSqueezyService.getSubscriptions() }); } 
  catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/lemon/products", async (req, res) => {
  try { res.json({ success: true, data: await lemonSqueezyService.getProducts() }); } 
  catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/lemon/licenses", async (req, res) => {
  try { res.json({ success: true, data: await lemonSqueezyService.getLicenses() }); } 
  catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.get("/lemon/revenue", async (req, res) => {
  try { res.json({ success: true, data: await lemonSqueezyService.getRevenueMetrics() }); } 
  catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});


export default router;
