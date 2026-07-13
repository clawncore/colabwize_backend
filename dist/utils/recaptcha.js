"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyRecaptcha = verifyRecaptcha;
const node_fetch_1 = __importDefault(require("node-fetch"));
/**
 * Verifies a reCAPTCHA v3 token with Google
 * @param token The token from the frontend
 * @param minScore Minimum acceptable score (default 0.5)
 * @returns Object with success status and score
 */
async function verifyRecaptcha(token, minScore = 0.5) {
    try {
        // Bypass in development
        if (process.env.NODE_ENV === "development" || process.env.SKIP_RECAPTCHA === "true") {
            console.log("[reCAPTCHA] Bypassing verification in development mode.");
            return { success: true, message: "Bypassed (development)" };
        }
        const v3Secret = process.env.RC_SECRET;
        const v2Secret = process.env.RC_V2_SECRET;
        if (!v3Secret && !v2Secret) {
            console.warn("[reCAPTCHA] No secret keys set. Bypassing verification.");
            return { success: true, message: "Bypassed (no keys)" };
        }
        // Try verifying with the primary v3 secret first
        let verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${v3Secret || v2Secret}&response=${token}`;
        let response = await (0, node_fetch_1.default)(verifyUrl, { method: "POST" });
        let data = (await response.json());
        // If it failed and we have a second key, try that too (one might be v2, one v3)
        if (!data.success && v3Secret && v2Secret) {
            console.log("[reCAPTCHA] Primary key failed, trying secondary key...");
            verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${v2Secret}&response=${token}`;
            response = await (0, node_fetch_1.default)(verifyUrl, { method: "POST" });
            data = (await response.json());
        }
        console.log("[reCAPTCHA] Verify result:", {
            success: data.success,
            score: data.score,
            action: data.action,
            type: data.score !== undefined ? "v3" : "v2",
        });
        if (!data.success) {
            return {
                success: false,
                message: "Security verification could not be completed. Please use a standard, up-to-date browser to avoid security risks.",
            };
        }
        // For v3, also check the score
        if (data.score !== undefined && data.score < minScore) {
            return {
                success: false,
                score: data.score,
                message: "Automated activity detected. Please complete the security challenge to proceed.",
            };
        }
        return { success: true, score: data.score };
        return { success: true, score: data.score };
    }
    catch (error) {
        console.error("[reCAPTCHA] Verification error:", error);
        // Fail open by default to avoid blocking all users on network error
        return { success: true, message: "Bypassed (error)" };
    }
}
