import express from "express";
import { HybridAuthService } from "../../services/hybridAuthService";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";
import { getSupabaseAdminClient } from "../../lib/supabase/client";

const router = express.Router();

/**
 * POST /api/auth/hybrid/send-otp
 * Send Supabase Magic Link / OTP
 */
router.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    const supabaseAdmin = await getSupabaseAdminClient();
    if (!supabaseAdmin) {
      throw new Error("Supabase admin client not available");
    }

    const { error } = await supabaseAdmin.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      },
    });

    if (error) {
      console.error("Supabase OTP Error:", error);
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    return res.json({
      success: true,
      otpSent: true,
    });
  } catch (error: any) {
    console.error("Send OTP Error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

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
