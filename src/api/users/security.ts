import { Router } from "express";
import { SecurityService } from "../../services/securityService";

const router: Router = Router();

router.get("/sessions", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const sessions = await SecurityService.getActiveSessions(userId, req);

    return res.json({ success: true, sessions });
  } catch (error: any) {
    console.error("Error fetching sessions:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.delete("/sessions/:sessionId", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { sessionId } = req.params;
    const result = await SecurityService.signOutSession(userId, sessionId);

    return res.json(result);
  } catch (error: any) {
    console.error("Error signing out session:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.delete("/sessions", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await SecurityService.signOutAllOtherSessions(userId);

    return res.json(result);
  } catch (error: any) {
    console.error("Error signing out all other sessions:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.get("/login-history", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const history = await SecurityService.getLoginHistory(userId, limit, offset);

    return res.json({ success: true, loginHistory: history });
  } catch (error: any) {
    console.error("Error fetching login history:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.get("/privacy", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const settings = await SecurityService.getPrivacySettings(userId);

    return res.json({ success: true, privacySettings: settings });
  } catch (error: any) {
    console.error("Error fetching privacy settings:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.put("/privacy", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { email_unusual_logins, notify_new_devices } = req.body as {
      email_unusual_logins?: boolean;
      notify_new_devices?: boolean;
    };

    if (email_unusual_logins === undefined && notify_new_devices === undefined) {
      return res.status(400).json({ error: "No settings provided to update" });
    }

    const updates: any = {};
    if (email_unusual_logins !== undefined) {
      updates.email_unusual_logins = email_unusual_logins;
    }
    if (notify_new_devices !== undefined) {
      updates.notify_new_devices = notify_new_devices;
    }

    const settings = await SecurityService.updatePrivacySettings(userId, updates);

    return res.json({ success: true, privacySettings: settings });
  } catch (error: any) {
    console.error("Error updating privacy settings:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.get("/settings", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const settings = await SecurityService.getSecuritySettings(userId);

    return res.json({ success: true, settings });
  } catch (error: any) {
    console.error("Error fetching security settings:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

export default router;