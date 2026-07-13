"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPlatformAdmin = void 0;
const logger_1 = __importDefault(require("../monitoring/logger"));
const ADMIN_WHITELIST = [
    "simbisai@colabwize.com",
    "craig@colabwize.com",
];
const isPlatformAdmin = (req, res, next) => {
    try {
        const user = req.user;
        // First line of defense: Auth middleware didn't populate user
        if (!user) {
            res.status(401).json({ error: "Unauthorized: No user session found" });
            return;
        }
        // Role check logic. Checking multiple common locations for safety in Supabase structures.
        const userRole = user.role ||
            user.user_metadata?.role ||
            user.app_metadata?.role;
        // Whitelist check
        const userEmail = user.email ? user.email.toLowerCase() : "";
        const isWhitelisted = ADMIN_WHITELIST.includes(userEmail);
        const isAuthoritativeAdmin = isWhitelisted || userEmail.endsWith("@colabwize.com");
        if (userRole === "admin" || isAuthoritativeAdmin) {
            logger_1.default.info(`[ADMIN ACCESS GRANTED] ${userEmail} (Method: ${isAuthoritativeAdmin ? "Email Whitelist" : "Role"})`);
            next();
        }
        else {
            logger_1.default.warn(`[ADMIN ACCESS DENIED] Email: ${userEmail}, Role: ${userRole}`);
            res.status(403).json({
                error: "Forbidden: Platform Administrator privileges required",
                details: "Your account does not have the required administrator role or whitelist status."
            });
        }
    }
    catch (error) {
        logger_1.default.error("Platform Admin Middleware Error:", error);
        res.status(500).json({ error: "Internal server error during authorization" });
    }
};
exports.isPlatformAdmin = isPlatformAdmin;
