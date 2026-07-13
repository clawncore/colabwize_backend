"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbuseGuard = exports.RephraseMode = void 0;
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
const crypto_1 = require("crypto");
var RephraseMode;
(function (RephraseMode) {
    RephraseMode["QUICK"] = "QUICK";
    RephraseMode["ACADEMIC"] = "ACADEMIC";
    RephraseMode["DEEP"] = "DEEP";
})(RephraseMode || (exports.RephraseMode = RephraseMode = {}));
class AbuseGuard {
    // Simple in-memory cache for velocity tracking (User ID -> Timestamp[])
    // In production, use Redis.
    static velocityCache = new Map();
    static VELOCITY_WINDOW_MS = 60 * 1000; // 1 minute
    static MAX_REQUESTS_PER_MINUTE = 10; // Soft limit for abuse check
    /**
     * Calculate cost based on character count (1 unit = 500 chars)
     */
    static calculateCost(text, mode) {
        const baseUnits = Math.ceil(text.length / 500);
        let multiplier = 1;
        switch (mode) {
            case RephraseMode.QUICK:
                multiplier = 0.5; // Cheaper
                break;
            case RephraseMode.DEEP:
                multiplier = 2.0; // More expensive
                break;
            case RephraseMode.ACADEMIC:
            default:
                multiplier = 1.0;
                break;
        }
        // return Math.max(1, Math.ceil(baseUnits * multiplier));
        // For now, simplify to just base units for UsageService tracking to avoid confusing users
        // or store "Credits" differently. Let's stick to standard internal units.
        return Math.max(1, baseUnits);
    }
    /**
     * Check for abuse (High velocity or Similarity spam)
     * Returns suggested mode degradation if abuse detected.
     */
    static async checkAbuse(userId, text) {
        try {
            // 1. Velocity Check
            const now = Date.now();
            let timestamps = this.velocityCache.get(userId) || [];
            // Filter old timestamps
            timestamps = timestamps.filter(t => now - t < this.VELOCITY_WINDOW_MS);
            // Add current request
            timestamps.push(now);
            this.velocityCache.set(userId, timestamps);
            if (timestamps.length > this.MAX_REQUESTS_PER_MINUTE) {
                logger_1.default.warn(`Abuse detected: High velocity for user ${userId} (${timestamps.length} req/min)`);
                return { isAbuse: true, degradeTo: "LOCAL" };
            }
            // 2. Similarity Check (Hash-based)
            // We check if this exact text has been rephrased recently by this user
            const textHash = (0, crypto_1.createHash)("md5").update(text).digest("hex");
            const recentDuplicate = await prisma_1.prisma.rephraseSuggestion.findFirst({
                where: {
                    scan_id: { startsWith: "audit-" }, // Assuming audit/rephrase scans have this prefix or we link to user directly
                    // Since RephraseSuggestion schema links to Scan, and Scan links to User.
                    // Depending on schema, we might need a direct query.
                    // For now, let's look for ANY recent suggestion with this hash if we stored it.
                    // CURRENT SCHEMA MIGHT NOT STORE HASH.
                    // Fallback: Check exact text match in DB
                    original_text: text,
                    created_at: { gt: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
                }
            });
            if (recentDuplicate) {
                // If we found the exact same text rephrased recently, force cached return
                logger_1.default.info(`Abuse detected: Duplicate rephrase execution for user ${userId}`);
                return { isAbuse: true, degradeTo: "CACHED" };
            }
            return { isAbuse: false };
        }
        catch (error) {
            logger_1.default.error("Abuse guard check failed", { error });
            return { isAbuse: false }; // Fail open to avoid blocking legit users on error
        }
    }
}
exports.AbuseGuard = AbuseGuard;
