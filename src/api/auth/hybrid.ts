import express from "express";
import { HybridAuthService } from "../../services/hybridAuthService";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";

const router = express.Router();

/**
 * POST /api/auth/hybrid/oauth-signup
 * Register user after OAuth callback
 */
router.post("/oauth-signup", async (req, res) => {
  try {
    const { id, email, fullName, provider } = req.body;

    if (!id || !email) {
      return res.status(400).json({
        success: false,
        message: "User ID and email are required",
      });
    }

    const result = await HybridAuthService.registerOAuthUser({
      id,
      email,
      fullName,
      provider,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    console.error("OAuth signup error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "OAuth registration failed",
    });
  }
});



/**
 * PUT /api/auth/hybrid/signin
 * Verify Supabase token and sync user to Postgres
 */
router.put("/signin", async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res
        .status(400)
        .json({ success: false, message: "ID token required" });
    }

    const result = await HybridAuthService.syncUserSession(idToken);

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res
        .status(401)
        .json({
          success: false,
          message: result.error || "Authentication failed",
        });
    }
  } catch (error: any) {
    console.error("Hybrid signin error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error during signin" });
  }
});

/**
 * PATCH /api/auth/hybrid/profile
 */
router.patch("/profile", async (req, res) => {
  try {
    const { idToken, updates } = req.body;
    if (!idToken) {
      return res
        .status(400)
        .json({ success: false, message: "ID token required" });
    }

    const result = await HybridAuthService.updateUserProfile(idToken, updates);

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json({ success: false, message: result.error });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: "Update failed" });
  }
});

export default router;
