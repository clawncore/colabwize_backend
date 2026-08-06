import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";

/**
 * Middleware to track user activity by updating last_seen_at on API requests.
 * This ensures user presence is recorded even without WebSocket connections.
 * Runs on every authenticated request and updates the User model.
 */
export const activityTracker = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Extract user ID from request (set by auth middleware)
    const userId = (req as any).user?.id || (req as any).adminUser?.userId;
    
    if (userId) {
      // Update last_seen_at asynchronously - don't block the request
      prisma.user.update({
        where: { id: userId },
        data: { last_seen_at: new Date() },
      }).catch((err) => {
        logger.debug("Activity tracker update failed:", err);
      });
    }
  } catch (error) {
    // Silently fail - activity tracking should never block requests
    logger.debug("Activity tracker error:", error);
  }
  
  next();
};
