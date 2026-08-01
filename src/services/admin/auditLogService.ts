import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { Request } from "express";

export interface AuditLogEntry {
  action: string;
  adminEmail: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Creates an audit log entry. Fire-and-forget — failures are logged but
 * do not affect the primary operation.
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        adminId: undefined,
        adminEmail: entry.adminEmail,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : undefined,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });
  } catch (err: any) {
    logger.error("Audit log write failed:", { action: entry.action, error: err.message });
  }
}

/**
 * Extracts audit-relevant context from an Express request.
 */
export function extractAuditContext(req: Request): Pick<AuditLogEntry, "ipAddress" | "userAgent"> {
  return {
    ipAddress: req.ip ?? req.headers["x-forwarded-for"] as string | undefined,
    userAgent: req.get("user-agent") ?? undefined,
  };
}

/**
 * Gets the admin email from a request object attached by auth middleware.
 */
export function getAdminEmail(req: Request): string {
  return (req as any).user?.email ?? "unknown-admin";
}
