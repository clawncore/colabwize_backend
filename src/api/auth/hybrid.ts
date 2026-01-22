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


/**
 * POST /api/auth/hybrid/send-otp
 * Send OTP for verification
 */
router.post("/send-otp", async (req, res) => {
  try {
    const { userId, email, method = "email", fullName } = req.body;

    if (!userId || !email) {
      return res.status(400).json({
        success: false,
        message: "User ID and email are required",
      });
    }

    // Import OTPService dynamically to avoid circular dependencies if any
    const { OTPService } = require("../../services/otpService");

    const result = await OTPService.sendOTP(
      userId,
      email,
      "", // Phone number
      method,
      fullName || ""
    );

    if (result) {
      return res.status(200).json({
        success: true,
        message: "OTP sent successfully",
      });
    } else {
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP",
      });
    }
  } catch (error: any) {
    console.error("Send OTP error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to send OTP",
    });
  }
});

/**
 * POST /api/auth/hybrid/verify-otp
 * Verify OTP code
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({
        success: false,
        message: "User ID and OTP are required",
      });
    }

    // Import OTPService dynamically
    const { OTPService } = require("../../services/otpService");

    const isValid = await OTPService.verifyOTP(userId, otp);

    if (isValid) {
      // If verified, we might want to mark the email as verified in Supabase/Database
      // But for now just return success
      return res.status(200).json({
        success: true,
        message: "OTP verified successfully",
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }
  } catch (error: any) {
    console.error("Verify OTP error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to verify OTP",
    });
  }
});

export default router;
