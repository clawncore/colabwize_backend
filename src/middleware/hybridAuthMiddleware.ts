import {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
} from "express";
import { authenticateExpressRequest } from "./auth";
import logger from "../monitoring/logger";

/**
 * Authentication middleware for Supabase Auth
 */
export async function authenticateHybridRequest(
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction
): Promise<void> {
  try {
    // Get the authorization header
    const authHeader = req.headers.authorization;
    let token: string | null = null;

    if (authHeader) {
      if (authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      } else if (!authHeader.includes(" ")) {
        token = authHeader;
      }
    }

    // Also check for token in query parameters as fallback (for OAuth popup flows)
    if (!token && req.query && typeof req.query.token === "string") {
      token = req.query.token;
    }

    if (!token) {
      res.status(401).json({
        success: false,
        message: "Authorization token missing",
      });
      return;
    }

    // Try Supabase authentication
    try {
      logger.debug("Attempting Supabase authentication");
      await authenticateExpressRequest(req, res, next);
      return;
    } catch (error) {
      logger.error("Supabase authentication failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      // authenticateExpressRequest already sent an error response; don't send another
      return;
    }
  } catch (error) {
    logger.error("Authentication error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({
      success: false,
      message: "Internal authentication error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Optional authentication - doesn't fail if no token
 */
export async function optionalHybridAuth(
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    let token: string | null = null;

    if (authHeader) {
      if (authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      } else if (!authHeader.includes(" ")) {
        token = authHeader;
      }
    }

    if (!token) {
      // No token - continue without authentication
      next();
      return;
    }

    // Try to authenticate with Supabase
    try {
      await authenticateExpressRequest(req, res, next);
      return;
    } catch (error) {
      // Silently continue without authentication
      next();
    }
  } catch (error) {
    // Continue even if optional auth fails
    next();
  }
}
