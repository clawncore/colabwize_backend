"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const securityService_1 = require("../../services/securityService");
const router = (0, express_1.Router)();
router.get("/sessions", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }
        const sessions = await securityService_1.SecurityService.getActiveSessions(userId, req);
        return res.json({ success: true, sessions });
    }
    catch (error) {
        console.error("Error fetching sessions:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});
router.delete("/sessions/:sessionId", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }
        const { sessionId } = req.params;
        const result = await securityService_1.SecurityService.signOutSession(userId, sessionId);
        return res.json(result);
    }
    catch (error) {
        console.error("Error signing out session:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});
router.delete("/sessions", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }
        const result = await securityService_1.SecurityService.signOutAllOtherSessions(userId);
        return res.json(result);
    }
    catch (error) {
        console.error("Error signing out all other sessions:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});
router.get("/login-history", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;
        const history = await securityService_1.SecurityService.getLoginHistory(userId, limit, offset);
        return res.json({ success: true, loginHistory: history });
    }
    catch (error) {
        console.error("Error fetching login history:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});
router.get("/privacy", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }
        const settings = await securityService_1.SecurityService.getPrivacySettings(userId);
        return res.json({ success: true, privacySettings: settings });
    }
    catch (error) {
        console.error("Error fetching privacy settings:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});
router.put("/privacy", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }
        const { email_unusual_logins, notify_new_devices } = req.body;
        if (email_unusual_logins === undefined && notify_new_devices === undefined) {
            return res.status(400).json({ error: "No settings provided to update" });
        }
        const updates = {};
        if (email_unusual_logins !== undefined) {
            updates.email_unusual_logins = email_unusual_logins;
        }
        if (notify_new_devices !== undefined) {
            updates.notify_new_devices = notify_new_devices;
        }
        const settings = await securityService_1.SecurityService.updatePrivacySettings(userId, updates);
        return res.json({ success: true, privacySettings: settings });
    }
    catch (error) {
        console.error("Error updating privacy settings:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});
router.get("/settings", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }
        const settings = await securityService_1.SecurityService.getSecuritySettings(userId);
        return res.json({ success: true, settings });
    }
    catch (error) {
        console.error("Error fetching security settings:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});
exports.default = router;
