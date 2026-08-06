"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activityTracker = void 0;
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
/**
 * Middleware to track user activity by updating last_seen_at on API requests.
 * This ensures user presence is recorded even without WebSocket connections.
 * Runs on every authenticated request and updates the User model.
 */
const activityTracker = async (req, res, next) => {
    try {
        // Extract user ID from request (set by auth middleware)
        const userId = req.user?.id || req.adminUser?.userId;
        if (userId) {
            // Update last_seen_at asynchronously - don't block the request
            prisma_1.prisma.user.update({
                where: { id: userId },
                data: { last_seen_at: new Date() },
            }).catch((err) => {
                logger_1.default.debug("Activity tracker update failed:", err);
            });
        }
    }
    catch (error) {
        // Silently fail - activity tracking should never block requests
        logger_1.default.debug("Activity tracker error:", error);
    }
    next();
};
exports.activityTracker = activityTracker;
