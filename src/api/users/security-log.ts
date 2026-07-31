import { Router } from "express";
import { SecurityLogService, SecurityLogFilters } from "../../services/securityLogService";

const router: Router = Router();

router.get("/logs", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const filters: SecurityLogFilters = {
      event_type: req.query.event_type as string | undefined,
      status: req.query.status as string | undefined,
      from_date: req.query.from_date ? new Date(req.query.from_date as string) : undefined,
      to_date: req.query.to_date ? new Date(req.query.to_date as string) : undefined,
      limit: parseInt(req.query.limit as string) || 50,
      offset: parseInt(req.query.offset as string) || 0,
    };

    const result = await SecurityLogService.getSecurityLogs(userId, filters);

    return res.json({ success: true, logs: result.logs, total: result.total });
  } catch (error: any) {
    console.error("Error fetching security logs:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const stats = await SecurityLogService.getSecurityLogStats(userId);

    return res.json({ success: true, stats });
  } catch (error: any) {
    console.error("Error fetching security log stats:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

export default router;