"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const hybridAuthService_1 = require("../../services/hybridAuthService");
const TwoFactorService_1 = require("../../services/TwoFactorService");
const router = express_1.default.Router();
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
        const result = await hybridAuthService_1.HybridAuthService.signUp(email, password, userData);
        if (result.success) {
            return res.status(201).json(result);
        }
        else {
            return res.status(400).json(result);
        }
    }
    catch (error) {
        console.error("Hybrid signup error:", error);
        return res.status(400).json({
            success: false,
            message: error.message || "Signup failed",
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
        const result = await hybridAuthService_1.HybridAuthService.checkEmail(email);
        return res.status(200).json({ success: true, ...result });
    }
    catch (error) {
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
        const { id, email, fullName, provider } = req.body;
        if (!id || !email) {
            return res.status(400).json({
                success: false,
                message: "User ID and email are required",
            });
        }
        const result = await hybridAuthService_1.HybridAuthService.registerOAuthUser({
            id,
            email,
            fullName,
            provider,
        });
        return res.status(200).json(result);
    }
    catch (error) {
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
        console.time("HybridSignin");
        const result = await hybridAuthService_1.HybridAuthService.syncUserSession(idToken);
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
            const ip = req.headers["x-forwarded-for"] || req.ip || "";
            const userAgent = req.headers["user-agent"] || "";
            if (result.user) {
                await hybridAuthService_1.HybridAuthService.recordLogin(result.user.id, ip, userAgent);
            }
            return res.status(200).json(result);
        }
        else {
            console.warn("Hybrid signin failed:", result.error);
            return res
                .status(401)
                .json({
                success: false,
                message: result.error || "Authentication failed",
            });
        }
    }
    catch (error) {
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
        const isValid = await TwoFactorService_1.TwoFactorService.validateLogin(userId, token);
        if (isValid) {
            const ip = req.headers["x-forwarded-for"] || req.ip || "";
            const userAgent = req.headers["user-agent"] || "";
            await hybridAuthService_1.HybridAuthService.recordLogin(userId, ip, userAgent);
            return res.status(200).json({
                success: true,
                message: "2FA verified",
            });
        }
        else {
            return res.status(401).json({ success: false, message: "Invalid authentication code" });
        }
    }
    catch (error) {
        console.error("2FA verify error:", error);
        return res.status(500).json({ success: false, message: "Verification failed" });
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
        const result = await hybridAuthService_1.HybridAuthService.updateUserProfile(idToken, updates);
        if (result.success) {
            return res.status(200).json(result);
        }
        else {
            return res.status(400).json({ success: false, message: result.error });
        }
    }
    catch (error) {
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
        const result = await hybridAuthService_1.HybridAuthService.resendVerification(email);
        if (result.success) {
            return res.status(200).json(result);
        }
        else {
            // Even if success is false (e.g. already verified), return 400 with the message
            return res.status(400).json(result);
        }
    }
    catch (error) {
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
        const result = await hybridAuthService_1.HybridAuthService.verifyOTP(userId || null, otp, email);
        if (result.success) {
            return res.status(200).json(result);
        }
        else {
            return res.status(400).json(result);
        }
    }
    catch (error) {
        return res
            .status(500)
            .json({ success: false, message: "Verification failed" });
    }
});
const recaptcha_1 = require("../../utils/recaptcha");
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
        const result = await (0, recaptcha_1.verifyRecaptcha)(token);
        if (!result.success) {
            return res.status(403).json({
                success: false,
                message: result.message || "Automated activity detected. Please try again or contact support.",
            });
        }
        return res.status(200).json({ success: true, message: "Verified", score: result.score });
    }
    catch (error) {
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
        const result = await hybridAuthService_1.HybridAuthService.resendVerification(email);
        return res.status(200).json(result);
    }
    catch (error) {
        return res
            .status(400)
            .json({ success: false, message: error.message || "Resend failed" });
    }
});
exports.default = router;
