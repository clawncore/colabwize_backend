"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateHybridRequest = authenticateHybridRequest;
exports.optionalHybridAuth = optionalHybridAuth;
const auth_1 = require("./auth");
const logger_1 = __importDefault(require("../monitoring/logger"));
/**
 * Authentication middleware for Supabase Auth
 */
async function authenticateHybridRequest(req, res, next) {
    try {
        // Get the authorization header
        const authHeader = req.headers.authorization;
        let token = null;
        if (authHeader) {
            if (authHeader.startsWith("Bearer ")) {
                token = authHeader.substring(7);
            }
            else if (!authHeader.includes(" ")) {
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
            logger_1.default.debug("Attempting Supabase authentication");
            await (0, auth_1.authenticateExpressRequest)(req, res, next);
            return;
        }
        catch (error) {
            logger_1.default.error("Supabase authentication failed", {
                error: error instanceof Error ? error.message : String(error),
            });
            // authenticateExpressRequest already sent an error response; don't send another
            return;
        }
    }
    catch (error) {
        logger_1.default.error("Authentication error", {
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
async function optionalHybridAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        let token = null;
        if (authHeader) {
            if (authHeader.startsWith("Bearer ")) {
                token = authHeader.substring(7);
            }
            else if (!authHeader.includes(" ")) {
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
            await (0, auth_1.authenticateExpressRequest)(req, res, next);
            return;
        }
        catch (error) {
            // Silently continue without authentication
            next();
        }
    }
    catch (error) {
        // Continue even if optional auth fails
        next();
    }
}
