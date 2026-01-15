import express from "express";
import { HybridAuthService } from "../../services/hybridAuthService";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";

const router = express.Router();

/**
 * POST /api/auth/hybrid/signup
 * Create user in Supabase + Postgres
 */
router.post("/signup", async (req, res) => {
  try {
    const { email, password, ...userData } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const result = await HybridAuthService.signUp(email, password, userData);

    if (result.success) {
      return res.status(201).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error: any) {
    console.error("Hybrid signup error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Signup failed",
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
 * POST /api/auth/hybrid/check-email
 */
router.post("/check-email", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email required" });
    }
    const result = await HybridAuthService.checkEmail(email);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Check email failed" });
  }
});

/**
 * POST /api/auth/hybrid/verify-otp
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const { userId, otp, email } = req.body; // email is optional fallback

    if (!otp) {
      return res.status(400).json({ success: false, message: "OTP required" });
    }

    // We need at least userId OR email
    if (!userId && !email) {
      return res
        .status(400)
        .json({ success: false, message: "User ID or Email required" });
    }

    const result = await HybridAuthService.verifyOTP(
      userId || null,
      otp,
      email
    );

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Verification failed" });
  }
});

/**
 * POST /api/auth/hybrid/send-otp
 */
router.post("/send-otp", async (req, res) => {
  try {
    const { email, method } = req.body;

    // Check if email is provided
    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email required" });
    }

    // Check for unsupported methods
    if (method === "sms") {
      return res
        .status(400)
        .json({ success: false, message: "SMS not supported yet" });
    }

    // Reuse existing resend verification logic which generates and sends OTP
    const result = await HybridAuthService.resendVerification(email);

    if (result.success) {
      return res.status(200).json(result);
    } else {
      // Even if success is false (e.g. already verified), return 400 with the message
      return res.status(400).json(result);
    }
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to send OTP" });
  }
});

/**
 * POST /api/auth/hybrid/resend-verification
 */
router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email required" });
    }
    const result = await HybridAuthService.resendVerification(email);
    return res.status(200).json(result);
  } catch (error: any) {
    return res
      .status(400)
      .json({ success: false, message: error.message || "Resend failed" });
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
