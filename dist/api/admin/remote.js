"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const platformAdmin_1 = require("../../middleware/platformAdmin");
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const auditLogService_1 = require("../../services/admin/auditLogService");
const router = express_1.default.Router();
router.use(platformAdmin_1.isPlatformAdmin);
// ────────────────────────────────────────────────
// Active sessions (remote management)
// ────────────────────────────────────────────────
router.get("/sessions", async (req, res) => {
    try {
        const sessions = await prisma_1.prisma.userSession.findMany({
            where: { ended_at: null },
            orderBy: { started_at: "desc" },
            take: 200,
            include: { user: { select: { email: true, full_name: true } } },
        });
        const activeSessions = sessions.map((s) => ({
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
    }
    catch (error) {
        logger_1.default.error("Remote sessions error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ────────────────────────────────────────────────
// Force logout a user (revoke all active sessions)
// ────────────────────────────────────────────────
router.post("/force-logout", async (req, res) => {
    try {
        const { userId } = zod_1.z.object({ userId: zod_1.z.string().min(1) }).parse(req.body);
        const result = await prisma_1.prisma.userSession.updateMany({
            where: { user_id: userId, ended_at: null },
            data: { ended_at: new Date() },
        });
        await (0, auditLogService_1.createAuditLog)({
            action: "USER_FORCE_LOGOUT",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "User",
            entityId: userId,
            metadata: { sessionsRevoked: result.count },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true, sessionsRevoked: result.count });
    }
    catch (error) {
        logger_1.default.error("Force logout error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
// ────────────────────────────────────────────────
// Send an in-app announcement to a segment of users
// ────────────────────────────────────────────────
router.post("/announcement", async (req, res) => {
    try {
        const { title, message, planFilter } = zod_1.z
            .object({
            title: zod_1.z.string().min(1),
            message: zod_1.z.string().min(1),
            planFilter: zod_1.z.enum(["all", "paid", "free"]).optional().default("all"),
        })
            .parse(req.body);
        // Determine the target audience from real subscription state.
        let userIds;
        if (planFilter === "paid") {
            userIds = await prisma_1.prisma.subscription.findMany({
                where: { status: "active" },
                select: { user_id: true },
            });
        }
        else if (planFilter === "free") {
            const paid = await prisma_1.prisma.subscription.findMany({
                where: { status: "active" },
                select: { user_id: true },
            });
            const paidSet = new Set(paid.map((p) => p.user_id));
            const all = await prisma_1.prisma.user.findMany({ select: { id: true } });
            userIds = all.filter((u) => !paidSet.has(u.id)).map((u) => ({ user_id: u.id }));
        }
        else {
            const all = await prisma_1.prisma.user.findMany({ select: { id: true } });
            userIds = all.map((u) => ({ user_id: u.id }));
        }
        if (userIds.length > 0) {
            await prisma_1.prisma.notification.createMany({
                data: userIds.map((u) => ({
                    user_id: u.user_id,
                    type: "announcement",
                    title,
                    message,
                })),
            });
        }
        await (0, auditLogService_1.createAuditLog)({
            action: "ANNOUNCEMENT_SENT",
            adminEmail: (0, auditLogService_1.getAdminEmail)(req),
            entityType: "Notification",
            metadata: { title, planFilter, recipients: userIds.length },
            ...(0, auditLogService_1.extractAuditContext)(req),
        });
        res.json({ success: true, data: { recipients: userIds.length } });
    }
    catch (error) {
        logger_1.default.error("Announcement error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});
exports.default = router;
