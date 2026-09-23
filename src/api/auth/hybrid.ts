import express from "express";
import { z } from "zod";
import { HybridAuthService } from "../../services/hybridAuthService";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";
import { TwoFactorService } from "../../services/TwoFactorService";
import { prisma } from "../../lib/prisma";

const router = express.Router();

/**
 * Maps internal error codes to safe, user-facing messages.
 * Never expose internal provider details to the client.
 */
const SAFE_ERROR_MESSAGES: Record<string, string> = {
  ACCOUNT_EXISTS: "An account with this email already exists. Please sign in instead.",
  SIGNUP_FAILED: "Failed to create account. Please try again or contact support.",
  INVALID_CREDENTIALS: "Invalid login credentials. Please check your email and password.",
  EMAIL_NOT_CONFIRMED: "Please confirm your email address before logging in.",
  RATE_LIMITED: "Too many attempts. Please try again in a few minutes.",
  INVALID_TOKEN: "This link is no longer valid or has expired.",
  EMAIL_SEND_FAILED: "We couldn't send the email right now. Please try again.",
};

function getSafeErrorMessage(rawMessage: string, code?: string): string {
  if (code && SAFE_ERROR_MESSAGES[code]) {
    return SAFE_ERROR_MESSAGES[code];
  }
  // Check for known patterns in the raw message and map to safe messages
  const lower = rawMessage.toLowerCase();
  if (lower.includes("already") || lower.includes("duplicate") || lower.includes("exists")) {
    return SAFE_ERROR_MESSAGES.ACCOUNT_EXISTS;
  }
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return SAFE_ERROR_MESSAGES.INVALID_CREDENTIALS;
  }
  return "Something went wrong. Please try again.";
}

// Zod schemas for validation
const resetPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

const confirmResetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/\d/, "Password must contain at least one number"),
});

/**
 * POST /api/auth/hybrid/signup
 * Create user in Supabase + Postgres
 */
router.post("/signup", async (req, res) => {
  try {
    // Check if registration is open
    const regConfig = await prisma.systemConfig.findUnique({ where: { key: "registration_open" } });
    if (regConfig && (regConfig.value as { enabled?: boolean })?.enabled === false) {
      return res.status(403).json({
        success: false,
        error: "Registrations are temporarily closed. Please contact support for an invitation.",
      });
    }

    const { email, password, ...userData } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const ipAddress = req.headers["x-forwarded-for"] as string | undefined || req.ip || "";
    const userAgent = req.headers["user-agent"] || "";
    const result = await HybridAuthService.signUp(email, password, userData, {
      ipAddress,
      userAgent,
    });

    if (result.success) {
      return res.status(201).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error: any) {
    console.error("Hybrid signup error:", error);
    const errCode = (error as any)?.code || "SIGNUP_FAILED";
    const safeMessage = getSafeErrorMessage(error.message || "Signup failed", errCode);
    return res.status(errCode === "ACCOUNT_EXISTS" ? 409 : 400).json({
      success: false,
      code: errCode,
      message: safeMessage,
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
 * POST /api/auth/hybrid/oauth-signup
 * Register user after OAuth callback
 */
router.post("/oauth-signup", async (req, res) => {
  try {
    const { id, email, fullName, provider, affiliate_ref } = req.body;

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
      affiliate_ref,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    console.error("OAuth signup error:", error);
    return res.status(400).json({
      success: false,
      message: getSafeErrorMessage(error.message, "OAUTH_SIGNUP_FAILED"),
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

    console.time("HybridSignin");
    const result = await HybridAuthService.syncUserSession(idToken);
    console.timeEnd("HybridSignin");

    console.log("DEBUG: detailed sync result", {
      success: result.success,
      userId: result.user?.id,
      has2FA: result.user?.two_factor_enabled,
      email: result.user?.email
    });

    if (result.success) {
      // Check if 2FA is required (either from user object or explicit flag)
      const is2FAEnabled = result.user?.two_factor_enabled;
      const isExplicitlyRequired = result.requires_2fa;

      console.log(`[HybridAuth] Sync success. UserID: ${result.user?.id}, 2FA Enabled: ${is2FAEnabled}, Explicit Required: ${isExplicitlyRequired}`);

      if ((result.user && result.user.two_factor_enabled) || result.requires_2fa) {
        console.log("DEBUG: 2FA Required for user", result.user?.id);
        return res.status(200).json({
          success: true,
          requires_2fa: true,
          userId: result.user?.id,
          message: "Two-factor authentication required"
        });
      }

      const ip = req.headers["x-forwarded-for"] as string || req.ip || "";
      const userAgent = req.headers["user-agent"] || "";
      if (result.user) {
        await HybridAuthService.recordLogin(result.user.id, ip, userAgent);
      }

      return res.status(200).json(result);
    } else {
      console.warn("Hybrid signin failed:", result.error);
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
 * POST /api/auth/hybrid/verify-2fa
 * Verify TOTP code during login
 */
router.post("/verify-2fa", async (req, res) => {
  try {
    const { userId, token } = req.body;

    if (!userId || !token) {
      return res.status(400).json({ success: false, message: "User ID and code required" });
    }

    const isValid = await TwoFactorService.validateLogin(userId, token);

    if (isValid) {
      const ip = req.headers["x-forwarded-for"] as string || req.ip || "";
      const userAgent = req.headers["user-agent"] || "";
      await HybridAuthService.recordLogin(userId, ip, userAgent);
      return res.status(200).json({
        success: true,
        message: "2FA verified",
      });
    } else {
      return res.status(401).json({ success: false, message: "Invalid authentication code" });
    }
  } catch (error: any) {
    // Distinguish configuration errors (503) from other 2FA failures
    const isConfigError = error.message?.includes("TWO_FACTOR_ENCRYPTION_KEY");
    console.error("2FA verify error:", error);
    return res.status(isConfigError ? 503 : 500).json({
      success: false,
      message: isConfigError
        ? "Two-factor authentication service is temporarily unavailable. Please contact support."
        : "Verification failed",
    });
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
 * POST /api/auth/hybrid/verify-otp
 * Verify OTP code
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
 * POST /api/auth/hybrid/reset-password
 * Request a password reset — generates token and sends email via Resend
 */
router.post("/reset-password", async (req, res) => {
  try {
    const parseResult = resetPasswordSchema.safeParse(req.body);

    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: parseResult.error.issues[0]?.message || "Invalid email",
      });
    }

    const { email } = parseResult.data;

    const result = await HybridAuthService.requestPasswordReset(email);

    return res.status(200).json(result);
  } catch (error: any) {
    console.error("Reset password error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to process password reset request",
    });
  }
});

/**
 * GET /api/auth/hybrid/reset-password/verify
 * Verify a password reset token
 */
router.get("/reset-password/verify", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== "string") {
      return res.status(400).json({
        success: false,
        error: "Token is required",
      });
    }

    const result = await HybridAuthService.verifyResetToken(token);

    return res.status(200).json({
      success: result.valid,
      email: result.email,
      message: result.message,
    });
  } catch (error: any) {
    console.error("Token verification error:", error);
    return res.status(500).json({
      success: false,
      error: "Token verification failed",
    });
  }
});

/**
 * POST /api/auth/hybrid/reset-password/confirm
 * Verify token and update password
 */
router.post("/reset-password/confirm", async (req, res) => {
  try {
    const parseResult = confirmResetPasswordSchema.safeParse(req.body);

    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: parseResult.error.issues[0]?.message || "Invalid request data",
      });
    }

    const { token, password } = parseResult.data;

    const result = await HybridAuthService.confirmPasswordReset(token, password);

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(401).json(result);
    }
  } catch (error: any) {
    console.error("Password reset confirm error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to reset password",
    });
  }
});

import { verifyRecaptcha } from "../../utils/recaptcha";

/**
 * POST /api/auth/hybrid/verify-recaptcha
 * Verify reCAPTCHA v3 token from frontend before login/signup
 */
router.post("/verify-recaptcha", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: "Token required" });
    }

    const result = await verifyRecaptcha(token);

    if (!result.success) {
      return res.status(403).json({
        success: false,
        message: result.message || "Automated activity detected. Please try again or contact support.",
      });
    }

    return res.status(200).json({ success: true, message: "Verified", score: result.score });
  } catch (error) {
    console.error("[reCAPTCHA] Verification endpoint error:", error);
    return res.status(200).json({ success: true, message: "Bypassed (error)" });
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
      .json({ success: false, message: getSafeErrorMessage(error.message, "EMAIL_SEND_FAILED") });
  }
});

export default router;

