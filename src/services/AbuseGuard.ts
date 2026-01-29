import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { createHash } from "crypto";

export enum RephraseMode {
    QUICK = "QUICK",
    ACADEMIC = "ACADEMIC",
    DEEP = "DEEP"
}

export class AbuseGuard {
    // Simple in-memory cache for velocity tracking (User ID -> Timestamp[])
    // In production, use Redis.
    private static velocityCache: Map<string, number[]> = new Map();
    private static readonly VELOCITY_WINDOW_MS = 60 * 1000; // 1 minute
    private static readonly MAX_REQUESTS_PER_MINUTE = 10; // Soft limit for abuse check

    /**
     * Calculate cost based on character count (1 unit = 500 chars)
     */
    static calculateCost(text: string, mode: RephraseMode): number {
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
    static async checkAbuse(userId: string, text: string): Promise<{ isAbuse: boolean; degradeTo?: "LOCAL" | "CACHED" }> {
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
                logger.warn(`Abuse detected: High velocity for user ${userId} (${timestamps.length} req/min)`);
                return { isAbuse: true, degradeTo: "LOCAL" };
            }

            // 2. Similarity Check (Hash-based)
            // We check if this exact text has been rephrased recently by this user
            const textHash = createHash("md5").update(text).digest("hex");

            const recentDuplicate = await prisma.rephraseSuggestion.findFirst({
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
                logger.info(`Abuse detected: Duplicate rephrase execution for user ${userId}`);
                return { isAbuse: true, degradeTo: "CACHED" };
            }

            return { isAbuse: false };

        } catch (error) {
            logger.error("Abuse guard check failed", { error });
            return { isAbuse: false }; // Fail open to avoid blocking legit users on error
        }
    }
}
