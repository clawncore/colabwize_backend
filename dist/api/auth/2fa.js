"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const hybridAuthMiddleware_1 = require("../../middleware/hybridAuthMiddleware");
const TwoFactorService_1 = require("../../services/TwoFactorService");
const router = express_1.default.Router();
// Setup 2FA: Generate QRCode and Secret
router.post("/setup", hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    console.log("🔥 ENTERED 2FA SETUP");
    try {
        const user = req.user;
        if (!user || !user.email || !user.id) {
            console.error("❌ 2FA ERROR: Missing user identity");
            return res.status(401).json({ error: "Unauthorized: Missing user identity" });
        }
        // Generate secret (Store in memory temporarily)
        const { secret, qrCodeUrl } = await TwoFactorService_1.TwoFactorService.generateSecret(user.email, user.id);
        console.log(`✅ 2FA Secret locally generated for user ${user.id}`);
        return res.status(200).json({
            qrCode: qrCodeUrl,
            manualKey: secret
        });
    }
    catch (error) {
        console.error("❌ 2FA ERROR:", error);
        return res.status(500).json({
            error: "2FA_FAILED",
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});
// Verify 2FA: Enable it given a token
router.post("/verify", hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const user = req.user;
        // In verify phase, we expect 'code' (sometimes called 'token')
        const { code, token } = req.body;
        const verificationCode = code || token;
        if (!user || !verificationCode) {
            return res.status(400).json({ error: "Missing verification code" });
        }
        // Phase 2: Load temporary secret (Correctness Rule)
        const secret = TwoFactorService_1.TwoFactorService.getTempSecret(user.id);
        if (!secret) {
            console.error(`❌ 2FA VERIFY ERROR: No pending secret for user ${user.id}`);
            return res.status(400).json({
                error: "2FA_SETUP_EXPIRED",
                message: "Setup session expired or invalid. Please restart 2FA setup."
            });
        }
        const result = await TwoFactorService_1.TwoFactorService.enable2FA(user.id, secret, verificationCode);
        console.log(`✅ 2FA Enabled for user ${user.id}`);
        return res.status(200).json({
            success: true,
            message: "2FA Enabled Successfully",
            backupCodes: result.backupCodes
        });
    }
    catch (error) {
        console.error("❌ 2FA VERIFY ERROR:", error);
        return res.status(400).json({
            success: false,
            message: error.message || "Invalid verification code"
        });
    }
});
// Disable 2FA
router.post("/disable", hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const user = req.user;
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ error: "Verification code required to disable 2FA" });
        }
        await TwoFactorService_1.TwoFactorService.disable2FA(user.id, token);
        return res.status(200).json({
            success: true,
            message: "2FA Disabled Successfully"
        });
    }
    catch (error) {
        console.error("2FA Disable Error:", error);
        return res.status(400).json({
            success: false,
            message: error.message || "Failed to disable 2FA"
        });
    }
});
exports.default = router;
