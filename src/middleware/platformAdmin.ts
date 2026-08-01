import { Request, Response, NextFunction } from "express";
import { AdminAuthService } from "../services/admin/adminAuthService";
import logger from "../monitoring/logger";

const ADMIN_WHITELIST = [
  "simbisai@colabwize.com",
  "craig@colabwize.com",
  "admin@colabwize.com",
];

export type AdminRole = "super_admin" | "admin" | "support" | "finance" | "moderator" | "devops" | "analytics";

export interface AdminUser {
  role: AdminRole;
  email: string;
  userId: string;
  permissions?: string[];
}

/**
 * Resolves the admin role for a request.
 * Prioritizes dedicated Admin JWT tokens over fallback user tokens.
 */
export function resolveAdminRole(req: Request): AdminRole | null {
  // 1. Check for dedicated Admin JWT token in Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const adminPayload = AdminAuthService.verifyToken(token);
    if (adminPayload) {
      (req as any).adminUser = adminPayload;
      return adminPayload.role as AdminRole;
    }
  }

  // 2. Fallback to user session/token check for legacy compatibility
  const user = (req as any).user;
  if (!user) return null;

  const userRole = user.role || user.user_metadata?.role || user.app_metadata?.role;
  const userEmail = user.email ? user.email.toLowerCase() : "";
  const isWhitelisted = ADMIN_WHITELIST.includes(userEmail);
  const isAuthoritativeAdmin = isWhitelisted || userEmail.endsWith("@colabwize.com");

  if (userRole === "super_admin") return "super_admin";
  if (userRole === "admin") return "admin";
  if (userRole === "moderator") return "moderator";
  if (isAuthoritativeAdmin) return "admin";

  return null;
}

/**
 * Helper to verify fine-grained permissions (e.g. 'users.read', 'payments.write')
 */
export function hasPermission(req: Request, requiredPermission: string): boolean {
  const role = resolveAdminRole(req);
  if (!role) return false;
  if (role === 'super_admin') return true;

  const adminPermissions: string[] = (req as any).adminUser?.permissions || [];
  if (adminPermissions.includes('*') || adminPermissions.includes(requiredPermission)) {
    return true;
  }
  return false;
}

export const isPlatformAdmin = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const role = resolveAdminRole(req);
    const userEmail = (req as any).adminUser?.email || (req as any).user?.email?.toLowerCase() || "unknown";

    if (role) {
      logger.info(`[ADMIN ACCESS GRANTED] ${userEmail} (Role: ${role})`);
      (req as any).adminRole = role;
      next();
    } else {
      logger.warn(`[ADMIN ACCESS DENIED] Email: ${userEmail}`);
      res.status(403).json({
        error: "Forbidden: Platform Administrator privileges required",
        details: "Your account does not have a valid separate administrator session.",
      });
    }
  } catch (error) {
    logger.error("Platform Admin Middleware Error:", error);
    res.status(500).json({ error: "Internal server error during authorization" });
  }
};
