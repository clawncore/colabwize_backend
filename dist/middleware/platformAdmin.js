"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPlatformAdmin = void 0;
exports.resolveAdminRole = resolveAdminRole;
exports.hasPermission = hasPermission;
const adminAuthService_1 = require("../services/admin/adminAuthService");
const prisma_1 = require("../lib/prisma");
const client_1 = require("../lib/supabase/client");
const logger_1 = __importDefault(require("../monitoring/logger"));
/**
 * Resolves a Supabase-authenticated user from the request. If a global
 * authMiddleware already attached `req.user` we reuse it; otherwise we verify
 * the Bearer token directly. This lets admin routers authenticate a Supabase
 * token without requiring the global `authMiddleware` (which would reject the
 * dedicated admin JWT issued by /api/admin/auth/login).
 */
async function resolveSupabaseUser(req) {
    const existing = req.user;
    if (existing)
        return existing;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer "))
        return null;
    const token = authHeader.split(" ")[1];
    try {
        const supabase = await (0, client_1.getSupabaseAdminClient)();
        if (!supabase)
            return null;
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data.user)
            return null;
        return data.user;
    }
    catch (err) {
        logger_1.default.error("Supabase user resolution failed:", err);
        return null;
    }
}
/**
 * Resolves the admin role for a request.
 *
 * Two sources are accepted, both of which must resolve to a real row in the
 * dedicated `admin_users` table:
 *
 *   1. A dedicated Admin JWT (issued by /api/admin/auth/login). The admin
 *      record is re-read from the DB so role/permission changes take effect
 *      immediately and revoked admins are denied even with a valid token.
 *   2. A Supabase-authenticated request whose email matches an `admin_users`
 *      row. This keeps the existing SPA flow working (the frontend sends the
 *      Supabase token) without any implicit admin grant.
 *
 * NOTE: There is intentionally NO email-suffix or hardcoded-whitelist
 * escalation here anymore. Platform access requires an explicit `AdminUser`
 * record. Use `POST /api/admin/auth/setup-initial` (or a seed script) to
 * provision the first super-admin.
 */
async function resolveAdminRole(req) {
    // 1. Dedicated Admin JWT
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        const adminPayload = adminAuthService_1.AdminAuthService.verifyToken(token);
        if (adminPayload) {
            const admin = await prisma_1.prisma.adminUser.findUnique({
                where: { id: adminPayload.adminId },
            });
            if (!admin)
                return null;
            req.adminUser = {
                role: admin.role,
                email: admin.email,
                userId: admin.id,
                permissions: admin.permissions,
            };
            return admin.role;
        }
    }
    // 2. Supabase-authenticated user, matched against the AdminUser table
    const user = await resolveSupabaseUser(req);
    if (!user)
        return null;
    const email = (user.email || "").toLowerCase();
    if (!email)
        return null;
    const admin = await prisma_1.prisma.adminUser.findUnique({ where: { email } });
    if (!admin)
        return null;
    req.adminUser = {
        role: admin.role,
        email: admin.email,
        userId: admin.id,
        permissions: admin.permissions,
    };
    return admin.role;
}
/**
 * Helper to verify fine-grained permissions (e.g. 'users.read', 'payments.write').
 * Roles are ordered so higher roles implicitly satisfy lower ones.
 */
async function hasPermission(req, requiredPermission) {
    const role = await resolveAdminRole(req);
    if (!role)
        return false;
    if (role === "super_admin")
        return true;
    const admin = req.adminUser;
    const adminPermissions = admin?.permissions || [];
    if (adminPermissions.includes("*") || adminPermissions.includes(requiredPermission)) {
        return true;
    }
    // Fine-grained permissions are explicit only — there is no implicit
    // role-to-permission mapping at this layer yet.
    return false;
}
const isPlatformAdmin = async (req, res, next) => {
    try {
        const role = await resolveAdminRole(req);
        const adminEmail = req.adminUser?.email || req.user?.email?.toLowerCase() || "unknown";
        if (role) {
            logger_1.default.info(`[ADMIN ACCESS GRANTED] ${adminEmail} (Role: ${role})`);
            req.adminRole = role;
            next();
        }
        else {
            logger_1.default.warn(`[ADMIN ACCESS DENIED] Email: ${adminEmail}`);
            res.status(403).json({
                error: "Forbidden: Platform Administrator privileges required",
                details: "Your account is not provisioned as an administrator.",
            });
        }
    }
    catch (error) {
        logger_1.default.error("Platform Admin Middleware Error:", error);
        res.status(500).json({ error: "Internal server error during authorization" });
    }
};
exports.isPlatformAdmin = isPlatformAdmin;
