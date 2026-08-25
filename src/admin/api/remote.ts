import express, { Router } from "express";
import { z } from "zod";
import { isPlatformAdmin } from "../middleware/platformAdmin";
import { adminOperationRateLimiter } from "../../middleware/rateLimiter";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { createAuditLog, extractAuditContext, getAdminEmail } from "../services/auditLogService";

const router: Router = express.Router();

router.use(isPlatformAdmin);
router.use(adminOperationRateLimiter);

// ────────────────────────────────────────────────
// Active sessions (remote management)
// ────────────────────────────────────────────────
router.get("/sessions", async (req, res) => {
  try {
    const sessions = await prisma.userSession.findMany({
      where: { ended_at: null },
      orderBy: { started_at: "desc" },
      take: 200,
      include: { user: { select: { email: true, full_name: true } } },
    });

    const activeSessions = sessions.map((s: { id: string; session_id: string; user_id: string; user?: { email: string | null; full_name: string | null } | null; started_at: Date }) => ({
      id: s.id,
      sessionId: s.session_id,
      userId: s.user_id,
      userEmail: s.user?.email ?? "unknown",
      userName: s.user?.full_name ?? null,
      startedAt: s.started_at.toISOString(),
    }));

    res.json({
      success: true,
      data: { activeSessions, totalActive: activeSessions.length },
    });
  } catch (error: any) {
    logger.error("Remote sessions error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Force logout a user (revoke all active sessions)
// ────────────────────────────────────────────────
router.post("/force-logout", async (req, res) => {
  try {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.body);
    const result = await prisma.userSession.updateMany({
      where: { user_id: userId, ended_at: null },
      data: { ended_at: new Date() },
    });

    await createAuditLog({
      action: "USER_FORCE_LOGOUT",
      adminEmail: getAdminEmail(req),
      entityType: "User",
      entityId: userId,
      metadata: { sessionsRevoked: result.count },
      ...extractAuditContext(req),
    });

    res.json({ success: true, sessionsRevoked: result.count });
  } catch (error: any) {
    logger.error("Force logout error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Send an in-app announcement to a segment of users
// ────────────────────────────────────────────────
router.post("/announcement", async (req, res) => {
  try {
    const { title, message, planFilter } = z
      .object({
        title: z.string().min(1),
        message: z.string().min(1),
        planFilter: z.enum(["all", "paid", "free"]).optional().default("all"),
      })
      .parse(req.body);

    // Determine the target audience from real subscription state.
    let userIds: { user_id: string }[];
    if (planFilter === "paid") {
      userIds = await prisma.subscription.findMany({
        where: { status: "active" },
        select: { user_id: true },
      });
    } else if (planFilter === "free") {
      const paid = await prisma.subscription.findMany({
        where: { status: "active" },
        select: { user_id: true },
      });
      const paidSet = new Set(paid.map((p: { user_id: string }) => p.user_id));
      const all = await prisma.user.findMany({ select: { id: true } });
      userIds = all.filter((u: { id: string }) => !paidSet.has(u.id)).map((u: { id: string }) => ({ user_id: u.id }));
    } else {
      const all = await prisma.user.findMany({ select: { id: true } });
      userIds = all.map((u: { id: string }) => ({ user_id: u.id }));
    }

    if (userIds.length > 0) {
      await prisma.notification.createMany({
        data: userIds.map((u) => ({
          user_id: u.user_id,
          type: "announcement",
          title,
          message,
        })),
      });
    }

    await createAuditLog({
      action: "ANNOUNCEMENT_SENT",
      adminEmail: getAdminEmail(req),
      entityType: "Notification",
      metadata: { title, planFilter, recipients: userIds.length },
      ...extractAuditContext(req),
    });

    res.json({ success: true, data: { recipients: userIds.length } });
  } catch (error: any) {
    logger.error("Announcement error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
