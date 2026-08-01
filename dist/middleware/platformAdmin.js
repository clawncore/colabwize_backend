"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPlatformAdmin = void 0;
exports.resolveAdminRole = resolveAdminRole;
exports.hasPermission = hasPermission;
const adminAuthService_1 = require("../services/admin/adminAuthService");
const logger_1 = __importDefault(require("../monitoring/logger"));
const ADMIN_WHITELIST = [
    "simbisai@colabwize.com",
    "craig@colabwize.com",
    "admin@colabwize.com",
];
/**
 * Resolves the admin role for a request.
 * Prioritizes dedicated Admin JWT tokens over fallback user tokens.
 */
function resolveAdminRole(req) {
    // 1. Check for dedicated Admin JWT token in Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const adminPayload = adminAuthService_1.AdminAuthService.verifyToken(token);
        if (adminPayload) {
            req.adminUser = adminPayload;
            return adminPayload.role;
        }
    }
    // 2. Fallback to user session/token check for legacy compatibility
    const user = req.user;
    if (!user)
        return null;
    const userRole = user.role || user.user_metadata?.role || user.app_metadata?.role;
    const userEmail = user.email ? user.email.toLowerCase() : "";
    const isWhitelisted = ADMIN_WHITELIST.includes(userEmail);
    const isAuthoritativeAdmin = isWhitelisted || userEmail.endsWith("@colabwize.com");
    if (userRole === "super_admin")
        return "super_admin";
    if (userRole === "admin")
        return "admin";
    if (userRole === "moderator")
        return "moderator";
    if (isAuthoritativeAdmin)
        return "admin";
    return null;
}
/**
 * Helper to verify fine-grained permissions (e.g. 'users.read', 'payments.write')
 */
function hasPermission(req, requiredPermission) {
    const role = resolveAdminRole(req);
    if (!role)
        return false;
    if (role === 'super_admin')
        return true;
    const adminPermissions = req.adminUser?.permissions || [];
    if (adminPermissions.includes('*') || adminPermissions.includes(requiredPermission)) {
        return true;
    }
    return false;
}
const isPlatformAdmin = (req, res, next) => {
    try {
        const role = resolveAdminRole(req);
        const userEmail = req.adminUser?.email || req.user?.email?.toLowerCase() || "unknown";
        if (role) {
            logger_1.default.info(`[ADMIN ACCESS GRANTED] ${userEmail} (Role: ${role})`);
            req.adminRole = role;
            next();
        }
        else {
            logger_1.default.warn(`[ADMIN ACCESS DENIED] Email: ${userEmail}`);
            res.status(403).json({
                error: "Forbidden: Platform Administrator privileges required",
                details: "Your account does not have a valid separate administrator session.",
            });
        }
    }
    catch (error) {
        logger_1.default.error("Platform Admin Middleware Error:", error);
        res.status(500).json({ error: "Internal server error during authorization" });
    }
};
exports.isPlatformAdmin = isPlatformAdmin;
