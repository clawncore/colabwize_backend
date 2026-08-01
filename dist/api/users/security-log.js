"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const securityLogService_1 = require("../../services/securityLogService");
const router = (0, express_1.Router)();
router.get("/logs", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }
        const filters = {
            event_type: req.query.event_type,
            status: req.query.status,
            from_date: req.query.from_date ? new Date(req.query.from_date) : undefined,
            to_date: req.query.to_date ? new Date(req.query.to_date) : undefined,
            limit: parseInt(req.query.limit) || 50,
            offset: parseInt(req.query.offset) || 0,
        };
        const result = await securityLogService_1.SecurityLogService.getSecurityLogs(userId, filters);
        return res.json({ success: true, logs: result.logs, total: result.total });
    }
    catch (error) {
        console.error("Error fetching security logs:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});
router.get("/stats", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }
        const stats = await securityLogService_1.SecurityLogService.getSecurityLogStats(userId);
        return res.json({ success: true, stats });
    }
    catch (error) {
        console.error("Error fetching security log stats:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});
exports.default = router;
