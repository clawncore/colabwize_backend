"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateHybrid = authenticateHybrid;
exports.withHybridAuth = withHybridAuth;
const logger_1 = __importDefault(require("../monitoring/logger"));
const auth_service_1 = require("../hybrid/supabase/auth-service");
/**
 * Authenticate requests using either JWT tokens or hybrid server auth
 * @param request The incoming request
 * @returns Authentication result or null if authentication failed
 */
async function authenticateHybrid(request) {
    try {
        // Log the incoming request for debugging
        logger_1.default.info("authenticateHybrid called", {
            url: request.url,
            method: request.method,
            // Note: Headers might not be available in all environments
        });
        // First, check if we're in the hybrid server context where user is already attached
        if (request.user?.id) {
            logger_1.default.debug("User already attached to request", {
                userId: request.user.id,
            });
            return {
                userId: request.user.id,
                type: "hybrid_server",
            };
        }
        // Get the authorization header
        // Handle cases where headers might not be available (e.g., mock requests)
        let authHeader = null;
        // Check for specific auth headers first
        if (request.headers && typeof request.headers.get === "function") {
            // Edge functions/Fetch API
            if (request.headers.get("x-auth-google")) {
                authHeader = request.headers.get("x-auth-google");
                logger_1.default.debug("Using X-Auth-Google header");
            }
            else if (request.headers.get("x-auth-organic")) {
                authHeader = request.headers.get("x-auth-organic");
                logger_1.default.debug("Using X-Auth-Organic header");
            }
            else {
                authHeader = request.headers.get("authorization");
            }
        }
        else if (request.headers && typeof request.headers === "object") {
            // Express/Node
            const headers = request.headers;
            if (headers["x-auth-google"]) {
                authHeader = headers["x-auth-google"];
                logger_1.default.debug("Using X-Auth-Google header");
            }
            else if (headers["x-auth-organic"]) {
                authHeader = headers["x-auth-organic"];
                logger_1.default.debug("Using X-Auth-Organic header");
            }
            else {
                authHeader = headers["authorization"] || headers["Authorization"] || null;
            }
        }
        logger_1.default.debug("Authorization header check", {
            hasHeader: !!authHeader,
            headerValue: authHeader ? authHeader.substring(0, 20) + "..." : "none",
        });
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            logger_1.default.warn("No valid authorization header found", {
                authHeader: authHeader ? "Present but invalid format" : "Missing",
                url: request.url,
            });
            return null;
        }
        const token = authHeader.substring(7); // Remove 'Bearer ' prefix
        logger_1.default.debug("Extracted token for authentication", {
            tokenLength: token.length,
            tokenStart: token.substring(0, 10) + "...",
        });
        // Authenticate as a JWT token
        try {
            logger_1.default.debug("Attempting JWT authentication");
            // Use the AuthService's supabase client which should be properly configured
            const client = await auth_service_1.AuthService.supabase;
            const { data, error } = await client.auth.getUser(token);
            if (!error && data?.user) {
                // Successfully authenticated with JWT
                logger_1.default.debug("JWT authentication successful", { userId: data.user.id });
                return {
                    userId: data.user.id,
                    type: "jwt",
                };
            }
            else {
                logger_1.default.warn("JWT authentication failed", {
                    error: error?.message,
                    hasData: !!data,
                    hasUser: !!data?.user,
                    url: request.url,
                });
                // Log more detailed error information
                if (error) {
                    logger_1.default.error("JWT authentication error details", {
                        errorName: error.name,
                        errorMessage: error.message,
                        errorStack: error.stack,
                    });
                }
            }
        }
        catch (jwtError) {
            // JWT authentication failed
            logger_1.default.warn("JWT authentication error", {
                error: jwtError instanceof Error ? jwtError.message : String(jwtError),
                url: request.url,
            });
            // Log detailed error information
            if (jwtError instanceof Error) {
                logger_1.default.error("JWT authentication exception", {
                    errorName: jwtError.name,
                    errorMessage: jwtError.message,
                    errorStack: jwtError.stack,
                });
            }
        }
        // Authentication failed
        logger_1.default.warn("Authentication failed", {
            url: request.url,
        });
        return null;
    }
    catch (error) {
        logger_1.default.error("Hybrid authentication error:", error);
        return null;
    }
}
/**
 * Middleware to wrap API handlers with hybrid authentication
 * Supports JWT tokens and hybrid server authentication
 * @param handler The API handler function
 * @returns Wrapped handler function
 */
function withHybridAuth(handler) {
    return async function (request) {
        logger_1.default.info("withHybridAuth called", {
            url: request.url,
            method: request.method,
        });
        const authResult = await authenticateHybrid(request);
        if (!authResult) {
            logger_1.default.warn("Authentication failed in withHybridAuth", {
                url: request.url,
                method: request.method,
            });
            return new Response(JSON.stringify({
                error: "Unauthorized",
                message: "Invalid or missing authentication token",
            }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Add auth result to request context
        const requestWithContext = {
            ...request,
            auth: authResult,
        };
        return handler(requestWithContext);
    };
}
