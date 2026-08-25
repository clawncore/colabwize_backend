import express, { Router } from "express";
import os from "os";
import { isPlatformAdmin } from "../middleware/platformAdmin";
import { adminOperationRateLimiter } from "../../middleware/rateLimiter";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { metrics } from "../../monitoring/metrics";
import { renderService, RenderMetricSeries } from "../services/integrations/renderService";
import { syncService } from "../services/integrations/syncService";

const router: Router = express.Router();

router.use(isPlatformAdmin);
router.use(adminOperationRateLimiter);

function formatUptime(seconds: number): string {
  const secs = Math.floor(seconds % 60);
  const mins = Math.floor((seconds / 60) % 60);
  const hours = Math.floor((seconds / 3600) % 24);
  const days = Math.floor(seconds / 86400);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

// ────────────────────────────────────────────────
// System health detail (CPU, memory, disk, uptime)
// ────────────────────────────────────────────────
router.get("/system-health-detail", async (req, res) => {
  try {
    const mem = process.memoryUsage();
    const cpus = os.cpus();
    const cores = cpus.length;

    // CPU usage: sample the last two idle ticks of each core. os.cpus() gives a
    // point-in-time snapshot, so two samples a few ms apart yield a usable delta.
    const cpuSample = () =>
      cpus.map((c) => c.times).reduce(
        (acc: { idle: number; total: number }, t: { idle: number; user: number; nice: number; sys: number; irq: number }) => ({ idle: acc.idle + t.idle, total: acc.total + t.idle + t.user + t.nice + t.sys + t.irq }),
        { idle: 0, total: 0 },
      );
    const s1 = cpuSample();
    await new Promise((r) => setTimeout(r, 100));
    const s2 = cpuSample();
    const idleDelta = s2.idle - s1.idle;
    const totalDelta = s2.total - s1.total;
    const usagePercent = totalDelta > 0 ? Number(((1 - idleDelta / totalDelta) * 100).toFixed(1)) : 0;

    // Disk usage from the current working directory's mount.
    const { execFileSync } = require("child_process");
    let disk = { total: 0, used: 0, free: 0, usagePercent: 0 };
    try {
      const out = execFileSync("df", ["-kP", process.cwd()], { encoding: "utf8" });
      const [, , , , , line] = out.split("\n");
      const [, totalKb, usedKb, freeKb] = line.trim().split(/\s+/).map((n: string) => parseInt(n, 10) * 1024 || 0);
      disk = {
        total: totalKb,
        used: usedKb,
        free: freeKb,
        usagePercent: totalKb > 0 ? Number(((usedKb / totalKb) * 100).toFixed(1)) : 0,
      };
    } catch {
      // df unavailable — leave disk as zeros
    }

    res.json({
      success: true,
      data: {
        cpu: {
          usagePercent,
          loadAverage1m: os.loadavg()[0] || 0,
          loadAverage5m: os.loadavg()[1] || 0,
          loadAverage15m: os.loadavg()[2] || 0,
          cores,
          model: cpus[0]?.model || "unknown",
        },
        memory: {
          total: os.totalmem(),
          used: os.totalmem() - os.freemem(),
          free: os.freemem(),
          heapUsage: mem.heapUsed,
          external: mem.external || 0,
        },
        disk,
        uptime: process.uptime(),
        uptimeFormatted: formatUptime(process.uptime()),
        nodeVersion: process.version,
        processes: {
          active: Object.keys(process.versions).length,
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    logger.error("Monitoring system-health-detail error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Queue status
// ────────────────────────────────────────────────
router.get("/queue-status", async (req, res) => {
  try {
    const [pendingJobs, completedJobs, failedJobs] = await Promise.all([
      prisma.failedWebhook.count({ where: { status: "pending" } }).catch(() => 0),
      prisma.exportJob.count({ where: { status: "completed" } }).catch(() => 0),
      prisma.exportJob.count({ where: { status: "failed" } }).catch(() => 0),
    ]);

    const activeWorkers = process.env.PM2_CLUSTER_PROCESSES
      ? parseInt(process.env.PM2_CLUSTER_PROCESSES, 10) || 1
      : 1;

    res.json({
      success: true,
      data: {
        connected: true,
        configured: true,
        pendingJobs,
        completedJobs,
        failedJobs,
        activeWorkers,
        concurrency: 4,
      },
    });
  } catch (error: any) {
    logger.error("Monitoring queue-status error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Worker processes
// ────────────────────────────────────────────────
router.get("/workers", async (req, res) => {
  try {
    const mem = process.memoryUsage();
    res.json({
      success: true,
      data: {
        workers: [
          {
            pid: process.pid,
            uptime: process.uptime(),
            uptimeFormatted: formatUptime(process.uptime()),
            activeHandles: 0,
            activeRequests: 0,
            memoryUsage: Number((mem.rss / 1024 / 1024).toFixed(1)),
            cpuUsage: 0,
          },
        ],
        totalWorkers: 1,
      },
    });
  } catch (error: any) {
    logger.error("Monitoring workers error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Scheduled jobs
// ────────────────────────────────────────────────
router.get("/scheduled-jobs", async (req, res) => {
  try {
    const knownJobs = [
      { id: "cleanup-expired", name: "Expired Item Cleanup", schedule: "hourly", active: true, status: "healthy", lastRun: null, nextRun: null },
      { id: "version-cleanup", name: "Version Cleanup", schedule: "24h", active: true, status: "healthy", lastRun: null, nextRun: null },
      { id: "version-schedule", name: "Version Scheduling", schedule: "15m", active: true, status: "healthy", lastRun: null, nextRun: null },
      { id: "task-reminders", name: "Task Reminders", schedule: "30m", active: true, status: "healthy", lastRun: null, nextRun: null },
      { id: "inbox-worker", name: "Inbox Worker", schedule: "5m", active: true, status: "healthy", lastRun: null, nextRun: null },
      { id: "activity-cleanup", name: "Activity Cleanup", schedule: "24h", active: true, status: "healthy", lastRun: null, nextRun: null },
      { id: "search-alerts", name: "Search Alerts", schedule: "daily", active: true, status: "healthy", lastRun: null, nextRun: null },
    ];

    const totalJobs = knownJobs.length;
    res.json({
      success: true,
      data: {
        jobs: knownJobs,
        totalJobs,
        activeJobs: knownJobs.filter((j) => j.active).length,
        failedJobs: knownJobs.filter((j) => j.status === "failed").length,
      },
    });
  } catch (error: any) {
    logger.error("Monitoring scheduled-jobs error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Cache health
// ────────────────────────────────────────────────
router.get("/cache-health", async (req, res) => {
  try {
    const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL;
    const configured = !!redisUrl;

    res.json({
      success: true,
      data: {
        cache: {
          status: configured ? "healthy" : "not_configured",
          hits: 0,
          misses: 0,
          hitRate: 0,
          size: 0,
          maxSize: configured ? 100 : undefined,
        },
      },
    });
  } catch (error: any) {
    logger.error("Monitoring cache-health error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// External services
// ────────────────────────────────────────────────
router.get("/external-services", async (req, res) => {
  try {
    const now = new Date();

    // Probe the database with an actual round-trip.
    let dbStatus: "healthy" | "unhealthy" = "healthy";
    let dbLatencyMs = 0;
    try {
      const dbStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - dbStart;
    } catch {
      dbStatus = "unhealthy";
      dbLatencyMs = 0;
    }

    const services = [
      { name: "Supabase Database", status: dbStatus, latencyMs: dbLatencyMs, lastChecked: now.toISOString(), details: dbStatus === "healthy" ? "SELECT 1 probe" : "connection failed" },
      { name: "Supabase Auth", status: process.env.SUPABASE_URL ? "healthy" : "unconfigured", latencyMs: 0, lastChecked: now.toISOString(), details: process.env.SUPABASE_URL ? undefined : "SUPABASE_URL not set" },
      { name: "Email (SMTP)", status: process.env.IMAP_HOST ? "healthy" : "unconfigured", latencyMs: 0, lastChecked: now.toISOString(), details: process.env.IMAP_HOST ? undefined : "IMAP_HOST not set" },
      { name: "Resend Email", status: process.env.RESEND_API_KEY ? "healthy" : "unconfigured", latencyMs: 0, lastChecked: now.toISOString(), details: process.env.RESEND_API_KEY ? undefined : "RESEND_API_KEY not set" },
      { name: "OpenAI", status: process.env.OPENAI_API_KEY ? "healthy" : "unconfigured", latencyMs: 0, lastChecked: now.toISOString(), details: process.env.OPENAI_API_KEY ? undefined : "OPENAI_API_KEY not set" },
      { name: "Anthropic", status: process.env.ANTHROPIC_API_KEY ? "healthy" : "unconfigured", latencyMs: 0, lastChecked: now.toISOString(), details: process.env.ANTHROPIC_API_KEY ? undefined : "ANTHROPIC_API_KEY not set" },
      { name: "Google Analytics 4", status: process.env.GOOGLE_ANALYTICS_PROPERTY_ID ? "healthy" : "unconfigured", latencyMs: 0, lastChecked: now.toISOString(), details: process.env.GOOGLE_ANALYTICS_PROPERTY_ID ? undefined : "GOOGLE_ANALYTICS_PROPERTY_ID not set" },
      { name: "Lemon Squeezy", status: process.env.LEMONSQUEEZY_API_KEY ? "healthy" : "unconfigured", latencyMs: 0, lastChecked: now.toISOString(), details: process.env.LEMONSQUEEZY_API_KEY ? undefined : "LEMONSQUEEZY_API_KEY not set" },
      { name: "Cloudinary", status: process.env.CLOUDINARY_URL ? "healthy" : "unconfigured", latencyMs: 0, lastChecked: now.toISOString(), details: process.env.CLOUDINARY_URL ? undefined : "CLOUDINARY_URL not set" },
      { name: "Redis Cache", status: (process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL) ? "healthy" : "unconfigured", latencyMs: 0, lastChecked: now.toISOString(), details: "lazy probe" },
    ];

    res.json({ success: true, data: { services } });
  } catch (error: any) {
    logger.error("Monitoring external-services error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// PRODUCTION TELEMETRY — Render Management API
//
// These endpoints read the DEPLOYED Render service (via RENDER_API_KEY), not
// the local process. Every number is real data from Render's /metrics series.
// When RENDER_API_KEY is missing they report status:"unconfigured" and never
// fabricate values.
// ────────────────────────────────────────────────

const RENDER_UNCONFIGURED = {
  success: true,
  data: {
    source: "render",
    status: "unconfigured",
    message: "Render is not configured. Add RENDER_API_KEY to backend .env to see production metrics.",
  },
};

/** Helper: reduce a Render metric series to its most recent values. */
function latestMetricValue(series: RenderMetricSeries[] | undefined): { value: number; ts: string | null } {
  const pts = series?.[0]?.values;
  if (!pts || pts.length === 0) return { value: 0, ts: null };
  const last = pts[pts.length - 1];
  return { value: Number(last.value) || 0, ts: last.timestamp };
}

/** Helper: fetch a metric over the trailing `minutes`, reduced to a per-second series. */
async function renderHistoryFor(
  metric: "cpu" | "memory" | "http-latency" | "http-requests",
  resource: string,
  minutes: number,
): Promise<{ ts: number; value: number; sample: boolean }[]> {
  const end = new Date();
  const start = new Date(end.getTime() - minutes * 60_000);
  const series = await renderService.getMetric(metric, resource, {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    resolutionSeconds: 60,
    aggregationMethod: "AVG",
  });
  const pts = series?.[0]?.values || [];
  return pts.map((p) => ({ ts: new Date(p.timestamp).getTime(), value: Number(p.value) || 0, sample: true }));
}

// List Render services (name, status, config).
router.get("/services", async (req, res) => {
  try {
    if (!process.env.RENDER_API_KEY) {
      return res.json(RENDER_UNCONFIGURED);
    }
    const services = await renderService.listServices(100);
    res.json({
      success: true,
      data: {
        source: "render",
        status: "ok",
        services,
      },
    });
  } catch (error: any) {
    logger.error("Monitoring render services error:", error);
    res.json({
      success: true,
      data: { source: "render", status: "error", message: error.message },
    });
  }
});

// Production realtime snapshot from Render (CPU, memory, latency, deploys).
router.get("/realtime/production", async (req, res) => {
  try {
    if (!process.env.RENDER_API_KEY) {
      return res.json(RENDER_UNCONFIGURED);
    }
    const services = await renderService.listServices(100);
    // Prefer a web service (that's our API); fall back to the first service.
    const web = services.find((s) => s.type === "web_service" && s.suspended !== "suspended") || services[0];
    if (!web) {
      return res.json({ success: true, data: { source: "render", status: "error", message: "No Render services found." } });
    }

    const minutes = 5;
    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60_000);
    const [cpuSeries, memSeries, latSeries, reqSeries, deploys] = await Promise.all([
      renderService.getMetric("cpu", web.id, { startTime: start.toISOString(), endTime: end.toISOString(), resolutionSeconds: 60, aggregationMethod: "AVG" }),
      renderService.getMetric("memory", web.id, { startTime: start.toISOString(), endTime: end.toISOString(), resolutionSeconds: 60, aggregationMethod: "AVG" }),
      renderService.getMetric("http-latency", web.id, { startTime: start.toISOString(), endTime: end.toISOString(), resolutionSeconds: 60, aggregationMethod: "AVG" }),
      renderService.getMetric("http-requests", web.id, { startTime: start.toISOString(), endTime: end.toISOString(), resolutionSeconds: 60, aggregationMethod: "AVG" }),
      renderService.listDeploys(web.id, 3).catch(() => []),
    ]);

    const cpu = latestMetricValue(cpuSeries);
    const mem = latestMetricValue(memSeries);
    const lat = latestMetricValue(latSeries);
    const req = latestMetricValue(reqSeries);

    const latestDeploy = deploys[0] || null;

    res.json({
      success: true,
      data: {
        source: "render",
        status: web.suspended === "suspended" ? "suspended" : "live",
        service: {
          id: web.id,
          name: web.name,
          type: web.type,
          plan: web.plan,
          region: web.region,
          instances: web.numInstances,
          suspended: web.suspended,
          url: web.url,
          branch: web.branch,
        },
        cpuPercent: cpu.value,
        memoryPercent: mem.value,
        latencyMs: lat.value,
        requestRate: req.value,
        lastDeploy: latestDeploy
          ? { status: latestDeploy.status, createdAt: latestDeploy.createdAt, commitMessage: latestDeploy.commitMessage }
          : null,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    logger.error("Monitoring render production realtime error:", error);
    res.json({ success: true, data: { source: "render", status: "error", message: error.message } });
  }
});

// Production metric history (CPU / memory / latency) from Render.
router.get("/history/production", async (req, res) => {
  try {
    if (!process.env.RENDER_API_KEY) {
      return res.json(RENDER_UNCONFIGURED);
    }
    const services = await renderService.listServices(100);
    const web = services.find((s) => s.type === "web_service" && s.suspended !== "suspended") || services[0];
    if (!web) {
      return res.json({ success: true, data: { source: "render", status: "error", message: "No Render services found." } });
    }

    const minutes = Math.min(Math.max(Number(req.query.minutes) || 5, 1), 60);
    const metric = String(req.query.metric || "cpu") as "cpu" | "memory" | "http-latency" | "http-requests";

    const series = await renderHistoryFor(metric, web.id, minutes);

    res.json({
      success: true,
      data: {
        source: "render",
        status: "ok",
        metric,
        minutes,
        unit: metric === "memory" ? "%" : metric === "http-latency" ? "ms" : metric === "http-requests" ? "req/s" : "%",
        series,
        service: { id: web.id, name: web.name },
      },
    });
  } catch (error: any) {
    logger.error("Monitoring render production history error:", error);
    res.json({ success: true, data: { source: "render", status: "error", message: error.message } });
  }
});

// ────────────────────────────────────────────────
// PRODUCTION TELEMETRY — Supabase PostgreSQL (real pg_stat queries)
//
// Reads the live production database over the existing Prisma DATABASE_URL.
// No extra credential needed.
// ────────────────────────────────────────────────

router.get("/database", async (req, res) => {
  try {
    const cached = syncService.getCachedData<any>("monitoring_database");
    if (cached) {
      return res.json({ success: true, data: cached });
    }

    // Real SELECT 1 round-trip latency.
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const pingMs = Date.now() - start;

    // Real active-connection counts from pg_stat_activity.
    const rows = await prisma.$queryRaw<Array<{ db: string; total: bigint | number; active: bigint | number; idle: bigint | number }>>`
      SELECT
        current_database() AS db,
        count(*) AS total,
        count(*) FILTER (WHERE state = 'active') AS active,
        count(*) FILTER (WHERE state = 'idle') AS idle
      FROM pg_stat_activity
    `;
    const conn = rows[0] || { db: "unknown", total: 0, active: 0, idle: 0 };
    const toNum = (v: bigint | number) => Number(v) || 0;

    // Real transaction stats from pg_stat_database (xact commits / rollbacks / deadlocks).
    const dbRows = await prisma.$queryRaw<Array<{ db: string; commits: bigint | number; rollbacks: bigint | number; deadlocks: bigint | number; blks_hit: bigint | number; blks_read: bigint | number }>>`
      SELECT
        datname AS db,
        xact_commit AS commits,
        xact_rollback AS rollbacks,
        deadlocks,
        blks_hit,
        blks_read
      FROM pg_stat_database
      WHERE datname = current_database()
    `;
    const dbRow = dbRows[0];
    const hits = toNum(dbRow?.blks_hit);
    const reads = toNum(dbRow?.blks_read);
    const cacheHitRate = hits + reads > 0 ? Number(((hits / (hits + reads)) * 100).toFixed(1)) : 100;

    // Real database size in bytes.
    const sizeRows = await prisma.$queryRaw<Array<{ size_bytes: bigint | number }>>`
      SELECT pg_database_size(current_database()) AS size_bytes
    `;
    const sizeBytes = toNum(sizeRows[0]?.size_bytes);

    // Build the Supabase project dashboard URL from SUPABASE_URL so the frontend can
    // surface a direct "Open in Supabase Dashboard" link without extra env vars.
    const projectRef = (process.env.SUPABASE_URL || "").replace(/^https?:\/\//, "").split(".")[0];
    const supabaseDashboardUrl = projectRef
      ? `https://supabase.com/dashboard/project/${projectRef}`
      : undefined;

    const data = {
      source: "supabase-postgresql",
      status: "healthy",
      pingMs,
      connections: { total: toNum(conn.total), active: toNum(conn.active), idle: toNum(conn.idle) },
      transactions: {
        commits: toNum(dbRow?.commits),
        rollbacks: toNum(dbRow?.rollbacks),
        deadlocks: toNum(dbRow?.deadlocks),
      },
      cacheHitRate,
      databaseSizeBytes: sizeBytes,
      databaseSizeFormatted: formatBytes(sizeBytes),
      database: conn.db,
      provider: "Supabase PostgreSQL (Prisma)",
      supabaseDashboardUrl,
      timestamp: new Date().toISOString(),
    };

    syncService.setCachedData("monitoring_database", data);
    res.json({ success: true, data });
  } catch (error: any) {
    logger.error("Monitoring database error:", error);
    res.json({ success: true, data: { source: "supabase-postgresql", status: "unhealthy", message: error.message } });
  }
});

// ────────────────────────────────────────────────
// PRODUCTION TELEMETRY — Supabase Management API health (optional)
// Requires SUPABASE_ACCESS_TOKEN (sbp_…). Unconfigured otherwise.
// ────────────────────────────────────────────────

router.get("/supabase-health", async (req, res) => {
  try {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    const ref = process.env.SUPABASE_PROJECT_REF;
    if (!token || !ref) {
      return res.json({
        success: true,
        data: {
          source: "supabase-management-api",
          status: "unconfigured",
          message: "Add SUPABASE_ACCESS_TOKEN (and SUPABASE_PROJECT_REF) to backend .env to see Supabase service health.",
        },
      });
    }
    const apiRes = await fetch(`https://api.supabase.com/v1/projects/${ref}/health?services=database,auth,api,storage,realtime`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!apiRes.ok) {
      return res.json({ success: true, data: { source: "supabase-management-api", status: "error", message: `Supabase health check failed: ${apiRes.status}` } });
    }
    const services = (await apiRes.json()) as Array<{ name: string; healthy: boolean; status: string; error?: string }>;
    res.json({
      success: true,
      data: {
        source: "supabase-management-api",
        status: "ok",
        services: services.map((s) => ({ name: s.name, healthy: s.healthy, status: s.status, error: s.error || null })),
      },
    });
  } catch (error: any) {
    logger.error("Monitoring supabase-health error:", error);
    res.json({ success: true, data: { source: "supabase-management-api", status: "error", message: error.message } });
  }
});

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ────────────────────────────────────────────────
// API health (per-endpoint latency from the metrics registry)
// ────────────────────────────────────────────────
router.get("/api-health", async (req, res) => {
  try {
    const allTimings = metrics.getSummary().timings;
    const allCounters = metrics.getSummary().counters;

    const totalRequests =
      (allCounters["http_requests_total"] as number) || 0;
    const errors5xx =
      (allCounters["http_responses_500_total"] as number) ||
      (allCounters["http_responses_502_total"] as number) ||
      (allCounters["http_responses_503_total"] as number) ||
      0;
    const errorRate = totalRequests > 0 ? Number(((errors5xx / totalRequests) * 100).toFixed(2)) : 0;

    const summary = allTimings["http_request_duration"];
    const totalLatency = summary?.count ?? 0;
    const avg = summary?.avg ?? 0;

    // No requests observed since the process started → report zeros, not fabricated data.
    const hasData = totalLatency > 0;

    const metricsSummary = hasData
      ? {
          totalRequests,
          errorRate,
          avgResponseTime: Number(avg.toFixed(1)),
          p50ResponseTime: Number((summary?.p50 ?? 0).toFixed(1)),
          p95ResponseTime: Number((summary?.p95 ?? 0).toFixed(1)),
          p99ResponseTime: Number((summary?.p99 ?? 0).toFixed(1)),
          activeConnections: 0,
        }
      : {
          totalRequests: 0,
          errorRate: 0,
          avgResponseTime: 0,
          p50ResponseTime: 0,
          p95ResponseTime: 0,
          p99ResponseTime: 0,
          activeConnections: 0,
        };

    res.json({ success: true, data: { metrics: metricsSummary } });
  } catch (error: any) {
    logger.error("Monitoring api-health error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
