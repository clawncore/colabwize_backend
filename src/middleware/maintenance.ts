import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";

/**
 * Maintenance state cache — when platform maintenance mode is enabled in
 * `systemConfig.maintenance_mode`, a banner notice is shown to users via
 * the frontend MaintenanceOverlay. This is advisory, not blocking — users
 * can still work on documents during partial maintenance (e.g. billing updates).
 *
 * We cache the lookup for 30s to avoid hammering Postgres on every request.
 * Use invalidateMaintenanceCache() after UPDATING the config to take effect
 * immediately.
 */

let cached: { enabled: boolean; reason: string | null; estimatedDuration: string | null; updatedAt: string | null; updatedBy: string | null } | null = null;
let cachedAt = 0;
const TTL_MS = 30_000;

async function readMaintenance() {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: "maintenance_mode" } });
    const v = (cfg?.value as { enabled?: boolean; reason?: string | null; estimatedDuration?: string | null } | undefined) || {};
    cached = {
      enabled: !!v.enabled,
      reason: v.reason ?? null,
      estimatedDuration: v.estimatedDuration ?? null,
      updatedAt: cfg?.updated_at?.toISOString() ?? null,
      updatedBy: cfg?.updatedBy ?? null,
    };
    cachedAt = now;
    return cached;
  } catch (err: any) {
    logger.error("maintenance middleware read failed:", err?.message || err);
    return { enabled: false, reason: null, estimatedDuration: null, updatedAt: null, updatedBy: null };
  }
}

export function invalidateMaintenanceCache() {
  cached = null;
  cachedAt = 0;
}

export async function maintenanceMiddleware(req: Request, res: Response, next: NextFunction) {
  // Always allow liveness, auth, admin, and webhooks through.
  const path = req.path;
  if (
    path === "/health" ||
    path === "/" ||
    path.startsWith("/api/health") ||
    path.startsWith("/api/admin") ||
    path.startsWith("/api/auth") ||
    path.startsWith("/api/webhooks")
  ) {
    return next();
  }

  const cfg = await readMaintenance();
  if (!cfg.enabled) return next();

  res.status(503).json({
    success: false,
    error: "Platform is under maintenance. Please try again later.",
    data: {
      maintenance: true,
      reason: cfg.reason,
      estimatedDuration: cfg.estimatedDuration,
      updatedAt: cfg.updatedAt,
      updatedBy: cfg.updatedBy,
    },
  });
}
