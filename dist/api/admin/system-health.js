"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const os_1 = __importDefault(require("os"));
const platformAdmin_1 = require("../../middleware/platformAdmin");
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const router = express_1.default.Router();
router.use(platformAdmin_1.isPlatformAdmin);
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const parts = [];
    if (days)
        parts.push(`${days}d`);
    if (hours)
        parts.push(`${hours}h`);
    if (minutes)
        parts.push(`${minutes}m`);
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
            await prisma_1.prisma.$queryRaw `SELECT 1`;
            latencyMs = Date.now() - start;
        }
        catch (err) {
            dbStatus = "error";
            latencyMs = -1;
            logger_1.default.error("System health DB probe failed:", err);
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
                    platform: os_1.default.platform(),
                    arch: os_1.default.arch(),
                },
                metrics: {
                    counters: {
                        processUptimeSeconds: Math.floor(process.uptime()),
                        cpus: os_1.default.cpus().length,
                        loadAvg1: os_1.default.loadavg()[0],
                    },
                    gauges: {
                        heapUsedMB: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
                        rssMB: Number((mem.rss / 1024 / 1024).toFixed(1)),
                        totalMemoryGB: Number((os_1.default.totalmem() / 1024 / 1024 / 1024).toFixed(1)),
                        freeMemoryMB: Number((os_1.default.freemem() / 1024 / 1024).toFixed(1)),
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
    }
    catch (error) {
        logger_1.default.error("System health error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.default = router;
