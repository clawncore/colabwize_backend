import express, { Router } from "express";
import os from "os";
import { isPlatformAdmin } from "../../middleware/platformAdmin";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";

const router: Router = express.Router();

router.use(isPlatformAdmin);

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

router.get("/", async (req, res) => {
  try {
    const mem = process.memoryUsage();

    // Cheap liveness probe against the database. The underlying driver keeps
    // its own pool, so this is a round-trip with the pooled connection.
    let dbStatus = "healthy";
    let latencyMs = 0;
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      latencyMs = Date.now() - start;
    } catch (err: any) {
      dbStatus = "error";
      latencyMs = -1;
      logger.error("System health DB probe failed:", err);
    }

    const heapUsagePercent = mem.heapTotal > 0
      ? ((mem.heapUsed / mem.heapTotal) * 100).toFixed(1)
      : "0";

    res.json({
      success: true,
      data: {
        server: {
          uptime: process.uptime(),
          uptimeFormatted: formatUptime(process.uptime()),
          memory: {
            rss: mem.rss,
            heapTotal: mem.heapTotal,
            heapUsed: mem.heapUsed,
            external: mem.external,
            arrayBuffers: mem.arrayBuffers || 0,
            heapUsagePercent,
          },
          pid: process.pid,
          nodeVersion: process.version,
          platform: os.platform(),
          arch: os.arch(),
        },
        metrics: {
          counters: {
            processUptimeSeconds: Math.floor(process.uptime()),
            cpus: os.cpus().length,
            loadAvg1: os.loadavg()[0],
          },
          gauges: {
            heapUsedMB: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
            rssMB: Number((mem.rss / 1024 / 1024).toFixed(1)),
            totalMemoryGB: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(1)),
            freeMemoryMB: Number((os.freemem() / 1024 / 1024).toFixed(1)),
          },
          timings: {
            databaseQueryMs: dbStatus === "healthy" ? { count: 1, avg: latencyMs, min: latencyMs, max: latencyMs, p50: latencyMs, p95: latencyMs, p99: latencyMs } : null,
          },
        },
        database: {
          status: dbStatus,
          latencyMs,
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    logger.error("System health error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
