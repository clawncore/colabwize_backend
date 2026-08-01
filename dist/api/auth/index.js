"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const hybridAuthMiddleware_1 = require("../../middleware/hybridAuthMiddleware");
const hybrid_1 = __importDefault(require("./hybrid"));
const _2fa_1 = __importDefault(require("./2fa"));
const zotero_1 = __importDefault(require("./zotero"));
const mendeley_1 = __importDefault(require("./mendeley"));
const googleDrive_1 = __importDefault(require("./googleDrive"));
const onedrive_1 = __importDefault(require("./onedrive"));
const prisma_1 = require("../../lib/prisma"); // For validation
const router = express_1.default.Router();
// Mount hybrid auth routes
router.use("/hybrid", hybrid_1.default);
router.use("/2fa", _2fa_1.default);
router.use("/zotero", zotero_1.default);
router.use("/mendeley", mendeley_1.default);
router.use("/google", googleDrive_1.default);
router.use("/onedrive", onedrive_1.default);
// Removed legacy routes (register, verify-otp, resend-otp, login)
// as we have migrated to Supabase Hybrid Auth.
/**
 * GET /api/auth/me
 * Get current user (requires authentication)
 */
router.get("/me", hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Not authenticated",
            });
        }
        return res.status(200).json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                username: user.email.split("@")[0],
                fullName: user.full_name,
                emailVerified: user.email_verified,
                surveyCompleted: user.survey_completed,
            },
        });
    }
    catch (error) {
        console.error("Get user error:", error);
        return res.status(200).json({
            success: false,
            message: "Service temporarily unavailable.",
        });
    }
});
/**
 * POST /api/auth/validate
 * Validate user details (email, phone, etc.) during signup
 */
router.post("/validate", async (req, res) => {
    try {
        const { email, phoneNumber, fullName } = req.body;
        const results = {};
        if (email) {
            const existing = await prisma_1.prisma.user.findUnique({ where: { email } });
            results.emailExists = !!existing;
            if (existing)
                results.message = "Email already registered";
        }
        if (phoneNumber) {
            // Find valid user by phone number
            const existing = await prisma_1.prisma.user.findFirst({
                where: { phone_number: phoneNumber },
            });
            results.phoneNumberExists = !!existing;
            if (existing)
                results.message = "Phone number already registered";
        }
        // Optional: add logic for full name or other fields if needed
        if (fullName) {
            results.fullNameExists = false;
        }
        return res.status(200).json({
            success: true,
            validationResults: results,
        });
    }
    catch (error) {
        console.error("Validation error:", error);
        return res
            .status(200)
            .json({ success: false, message: "Validation service unavailable" });
    }
});
exports.default = router;
