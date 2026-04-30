<<<<<<< Updated upstream
import { Request, Response, NextFunction } from "express";
import logger from "../monitoring/logger";

const ADMIN_WHITELIST = [
  "simbisai@colabwize.com",
  "craig@colabwize.com",
];

export const isPlatformAdmin = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const user = (req as any).user;

    // First line of defense: Auth middleware didn't populate user
    if (!user) {
      res.status(401).json({ error: "Unauthorized: No user session found" });
      return;
    }

    // Role check logic. Checking multiple common locations for safety in Supabase structures.
    const userRole =
      user.role ||
      user.user_metadata?.role ||
      user.app_metadata?.role;

    // Whitelist check
    const userEmail = user.email ? user.email.toLowerCase() : "";
    const isWhitelisted = ADMIN_WHITELIST.includes(userEmail);

    const isAuthoritativeAdmin = isWhitelisted || userEmail.endsWith("@colabwize.com");

    if (userRole === "admin" || isAuthoritativeAdmin) {
      logger.info(`[ADMIN ACCESS GRANTED] ${userEmail} (Method: ${isAuthoritativeAdmin ? "Email Whitelist" : "Role"})`);
      next();
    } else {
      logger.warn(`[ADMIN ACCESS DENIED] Email: ${userEmail}, Role: ${userRole}`);
      res.status(403).json({ 
        error: "Forbidden: Platform Administrator privileges required",
        details: "Your account does not have the required administrator role or whitelist status."
      });
    }
  } catch (error) {
    logger.error("Platform Admin Middleware Error:", error);
    res.status(500).json({ error: "Internal server error during authorization" });
  }
};
=======
import { Request, Response, NextFunction } from "express";
import logger from "../monitoring/logger";

const ADMIN_WHITELIST = [
  "simbisai@colabwize.com",
  "craig@colabwize.com",
  "craign@colabwize.com",
];

export const isPlatformAdmin = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const user = (req as any).user;

    // First line of defense: Auth middleware didn't populate user
    if (!user) {
      res.status(401).json({ error: "Unauthorized: No user session found" });
      return;
    }

    // Role check logic. Checking multiple common locations for safety in Supabase structures.
    const userRole =
      user.role ||
      user.user_metadata?.role ||
      user.app_metadata?.role;

    // Whitelist check
    const userEmail = user.email ? user.email.toLowerCase() : "";
    const isWhitelisted = ADMIN_WHITELIST.includes(userEmail);

    const isAuthoritativeAdmin = isWhitelisted || userEmail.endsWith("@colabwize.com");

    if (userRole === "admin" || isAuthoritativeAdmin) {
      logger.info(`[ADMIN ACCESS GRANTED] ${userEmail} (Method: ${isAuthoritativeAdmin ? "Email Whitelist" : "Role"})`);
      next();
    } else {
      logger.warn(`[ADMIN ACCESS DENIED] Email: ${userEmail}, Role: ${userRole}`);
      res.status(403).json({ 
        error: "Forbidden: Platform Administrator privileges required",
        details: "Your account does not have the required administrator role or whitelist status."
      });
    }
  } catch (error) {
    logger.error("Platform Admin Middleware Error:", error);
    res.status(500).json({ error: "Internal server error during authorization" });
  }
};
>>>>>>> Stashed changes
