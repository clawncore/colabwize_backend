import express, { Router } from "express";
import { isPlatformAdmin } from "../../middleware/platformAdmin";
import { adminOperationRateLimiter } from "../../middleware/rateLimiter";
import { gaService } from "../../services/admin/integrations/googleAnalyticsService";
import { lemonSqueezyService } from "../../services/admin/integrations/lemonSqueezyService";
import { syncService } from "../../services/admin/integrations/syncService";
import logger from "../../monitoring/logger";

const router: Router = express.Router();

router.use(isPlatformAdmin);
router.use(adminOperationRateLimiter);

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

router.get("/google-analytics/daily", async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    res.json({ success: true, data: await gaService.getDailyTraffic(days) }); 
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
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


// ==========================================
// Generic integration health helpers
// ==========================================

interface IntegrationStatus {
  service: string;
  isConfigured: boolean;
  health: 'healthy' | 'pending_configuration' | 'error';
  lastSync: string | null;
  [key: string]: unknown;
}

function getSyncTimestamp(service: string): string | null {
  try {
    const logs = syncService.getSyncLogs(service);
    return logs && logs.length > 0 ? logs[0].timestamp : null;
  } catch {
    return null;
  }
}

function envStatus(
  service: string,
  envVars: string[],
  extras: Record<string, unknown> = {}
): IntegrationStatus {
  const missing = envVars.filter((v) => !process.env[v]);
  const isConfigured = missing.length === 0;
  return {
    service,
    isConfigured,
    health: isConfigured ? 'healthy' : 'pending_configuration',
    lastSync: getSyncTimestamp(service),
    missingEnvVars: missing,
    ...extras,
  };
}

// ==========================================
// OpenAI
// ==========================================

router.get("/openai/status", (req, res) => {
  res.json({
    success: true,
    data: envStatus("OpenAI", ["OPENAI_API_KEY"], {
      apiVersion: "v1",
      baseUrl: "https://api.openai.com/v1",
    }),
  });
});

router.post("/openai/test", async (req, res) => {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(400).json({ success: false, error: "OPENAI_API_KEY is not set." });
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ success: false, error: `OpenAI ${r.status}: ${errText.slice(0, 200)}` });
    }
    res.json({ success: true, message: "OpenAI connection successful" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/openai/sync", async (req, res) => {
  try {
    syncService.invalidateCache();
    res.json({ success: true, message: "OpenAI cache cleared" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// Anthropic
// ==========================================

router.get("/anthropic/status", (req, res) => {
  res.json({
    success: true,
    data: envStatus("Anthropic", ["ANTHROPIC_API_KEY"], {
      apiVersion: "2023-06-01",
      baseUrl: "https://api.anthropic.com/v1",
    }),
  });
});

router.post("/anthropic/test", async (req, res) => {
  try {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return res.status(400).json({ success: false, error: "ANTHROPIC_API_KEY is not set." });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 5,
        messages: [{ role: "user", content: "ok" }],
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ success: false, error: `Anthropic ${r.status}: ${errText.slice(0, 200)}` });
    }
    res.json({ success: true, message: "Anthropic connection successful" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/anthropic/sync", async (req, res) => {
  try {
    syncService.invalidateCache();
    res.json({ success: true, message: "Anthropic cache cleared" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// SMTP
// ==========================================

router.get("/smtp/status", (req, res) => {
  res.json({
    success: true,
    data: envStatus("SMTP", ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"], {
      host: process.env.SMTP_HOST || null,
      port: process.env.SMTP_PORT || null,
      user: process.env.SMTP_USER || null,
    }),
  });
});

router.post("/smtp/test", async (req, res) => {
  try {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    if (!host) return res.status(400).json({ success: false, error: "SMTP_HOST is not set." });
    // Try to open a TCP connection to confirm reachability (no email sent)
    const net = await import("net");
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 5000);
      socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve(true); });
      socket.once("error", () => { clearTimeout(timer); socket.destroy(); resolve(false); });
      socket.connect(port, host);
    });
    if (!reachable) return res.status(502).json({ success: false, error: `Cannot reach ${host}:${port}` });
    res.json({ success: true, message: `SMTP reachable at ${host}:${port}` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/smtp/sync", async (req, res) => {
  try {
    syncService.invalidateCache();
    res.json({ success: true, message: "SMTP cache cleared" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// GitHub
// ==========================================

router.get("/github/status", (req, res) => {
  res.json({
    success: true,
    data: envStatus("GitHub", ["GITHUB_TOKEN"], {
      apiVersion: "v3",
      baseUrl: "https://api.github.com",
      hasToken: !!process.env.GITHUB_TOKEN,
    }),
  });
});

router.post("/github/test", async (req, res) => {
  try {
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch("https://api.github.com/zen", { headers });
    if (!r.ok) {
      return res.status(r.status).json({ success: false, error: `GitHub ${r.status}` });
    }
    const text = await r.text();
    res.json({ success: true, message: `GitHub reachable: "${text.slice(0, 80)}"` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/github/sync", async (req, res) => {
  try {
    syncService.invalidateCache();
    res.json({ success: true, message: "GitHub cache cleared" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// Cloudinary
// ==========================================

router.get("/cloudinary/status", (req, res) => {
  res.json({
    success: true,
    data: envStatus("Cloudinary", ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"], {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME || null,
      apiVersion: "v1_1",
    }),
  });
});

router.post("/cloudinary/test", async (req, res) => {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      return res.status(400).json({ success: false, error: "Cloudinary credentials missing." });
    }
    // Cloudinary ping endpoint (signature-based; use API key/secret directly)
    const r = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/ping`, {
      headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}` },
    });
    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ success: false, error: `Cloudinary ${r.status}: ${errText.slice(0, 200)}` });
    }
    res.json({ success: true, message: `Cloudinary reachable: ${cloudName}` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/cloudinary/sync", async (req, res) => {
  try {
    syncService.invalidateCache();
    res.json({ success: true, message: "Cloudinary cache cleared" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// Supabase
// ==========================================

router.get("/supabase/status", (req, res) => {
  res.json({
    success: true,
    data: envStatus("Supabase", ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], {
      apiVersion: "v1",
      url: process.env.SUPABASE_URL || null,
    }),
  });
});

router.post("/supabase/test", async (req, res) => {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      return res.status(400).json({ success: false, error: "Supabase URL or key missing." });
    }
    // Hit Supabase health endpoint
    const r = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ success: false, error: `Supabase ${r.status}: ${errText.slice(0, 200)}` });
    }
    res.json({ success: true, message: `Supabase reachable: ${url}` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/supabase/sync", async (req, res) => {
  try {
    syncService.invalidateCache();
    res.json({ success: true, message: "Supabase cache cleared" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// Google Search Console
// ==========================================

router.get("/google-search-console/status", (req, res) => {
  res.json({
    success: true,
    data: envStatus("Google Search Console", ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_SEARCH_CONSOLE_SITE_URL"], {
      apiVersion: "v1",
      siteUrl: process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL || null,
    }),
  });
});

router.post("/google-search-console/test", async (req, res) => {
  try {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS || !process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL) {
      return res.status(400).json({ success: false, error: "Google Search Console credentials missing." });
    }
    res.json({ success: true, message: "Google Search Console credentials present" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/google-search-console/sync", async (req, res) => {
  try {
    syncService.invalidateCache();
    res.json({ success: true, message: "GSC cache cleared" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


export default router;

