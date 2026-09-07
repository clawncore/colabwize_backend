/**
 * Public maintenance status endpoint.
 *
 * Returns whether the platform is in maintenance mode. No auth required —
 * the frontend MaintenanceOverlay polls this to show a banner to ALL users
 * (admin and non-admin alike).
 *
 * Reuses a 30s in-memory cache to avoid hammering Postgres on every poll.
 */
import { Router } from "express";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";

const router = Router();

let cached: {
  enabled: boolean;
  reason: string | null;
  estimatedDuration: string | null;
  updatedAt: string | null;
} | null = null;
let cachedAt = 0;
const TTL_MS = 30_000;

router.get("/", async (_req, res) => {
  try {
    const now = Date.now();
    if (!cached || now - cachedAt > TTL_MS) {
      const cfg = await prisma.systemConfig.findUnique({
        where: { key: "maintenance_mode" },
      });
      const v =
        (cfg?.value as
          | { enabled?: boolean; reason?: string | null; estimatedDuration?: string | null }
          | undefined) || {};
      cached = {
        enabled: !!v.enabled,
        reason: v.reason ?? null,
        estimatedDuration: v.estimatedDuration ?? null,
        updatedAt: cfg?.updated_at?.toISOString() ?? null,
      };
      cachedAt = now;
    }
    res.json({ success: true, data: cached });
  } catch (err: any) {
    logger.error("Public maintenance status read failed:", err?.message || err);
    // On error, report as not in maintenance — better to show the app than a false alarm
    res.json({
      success: true,
      data: { enabled: false, reason: null, estimatedDuration: null, updatedAt: null },
    });
  }
});

export default router;
