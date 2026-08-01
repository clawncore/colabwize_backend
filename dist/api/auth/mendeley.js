"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const crypto_1 = require("crypto");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const rateLimiter_1 = require("../../middleware/rateLimiter");
const prisma_1 = require("../../lib/prisma");
const hybridAuthMiddleware_1 = require("../../middleware/hybridAuthMiddleware");
const mendeleyService_1 = require("../../services/mendeleyService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
/**
 * CSRF state store for Mendeley OAuth.
 * Maps state token → { userId, expiresAt }. Auto-expires after 10 minutes.
 */
const oauthStateStore = new Map();
/** Clean expired state entries every 5 minutes */
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of oauthStateStore) {
        if (value.expiresAt < now)
            oauthStateStore.delete(key);
    }
}, 5 * 60 * 1000);
function generateMendeleyState(userId) {
    const state = (0, crypto_1.randomBytes)(32).toString("hex");
    oauthStateStore.set(state, { userId, expiresAt: Date.now() + 10 * 60 * 1000 });
    return state;
}
/** Rate limiters for Mendeley OAuth endpoints */
const oauthInitLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: "Too many Mendeley OAuth initiation attempts. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});
const oauthCallbackLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: 20,
    message: { error: "Too many Mendeley OAuth callback attempts. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});
const router = express_1.default.Router();
const MENDELEY_CLIENT_ID = (process.env.MENDELEY_CLIENT_ID || "").trim();
const MENDELEY_CLIENT_SECRET = (process.env.MENDELEY_CLIENT_SECRET || "").trim();
const MENDELEY_API_KEY = (process.env.MENDELEY_API_KEY || "").trim();
// Standard Mendeley OAuth Endpoints
const AUTHORIZE_URL = "https://api.mendeley.com/oauth/authorize";
const TOKEN_URL = "https://api.mendeley.com/oauth/token";
// Dynamic Redirect URI based on environment
const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:3001").replace(/\/$/, "");
const CALLBACK_URL = `${BACKEND_URL}/api/auth/mendeley/callback`;
/**
 * GET /api/auth/mendeley/connect
 * Initiate Elsevier/Mendeley OAuth flow
 */
router.get("/connect", oauthInitLimiter, hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const userId = req.user.id;
        // Use the Mendeley OAuth flow with a cryptographic CSRF state token
        const state = generateMendeleyState(userId);
        const authUrl = new URL(AUTHORIZE_URL);
        authUrl.searchParams.append("response_type", "code");
        authUrl.searchParams.append("client_id", MENDELEY_CLIENT_ID);
        authUrl.searchParams.append("redirect_uri", CALLBACK_URL);
        authUrl.searchParams.append("scope", "all");
        authUrl.searchParams.append("state", state);
        logger_1.default.info(`[Mendeley Connect] Initiating OAuth for user: ${userId}`);
        return res.redirect(authUrl.toString());
    }
    catch (error) {
        console.error("[Mendeley Connect] Fatal Error:", error.message);
        return res.redirect(`${process.env.FRONTEND_URL || "https://app.colabwize.com"}/dashboard/settings/account?mendeley_error=initiation_failed`);
    }
});
/**
 * POST /api/auth/mendeley/link
 * Link a project to use Mendeley library
 */
router.post("/link", hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const { projectId } = req.body;
        if (!projectId)
            return res.status(400).json({ error: "projectId is required" });
        await prisma_1.prisma.project.update({
            where: { id: projectId },
            data: { linked_library: "mendeley" }
        });
        return res.json({ success: true, message: "Project linked to Mendeley" });
    }
    catch (error) {
        console.error("[Mendeley Link] Error:", error.message);
        return res.status(500).json({ error: error.message });
    }
});
/**
 * GET /api/auth/mendeley/debug
 * Diagnostic endpoint for Mendeley integration
 */
router.get("/debug", hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                mendeley_access_token: true,
                mendeley_token_expires_at: true
            }
        });
        return res.json({
            status: "success",
            timestamp: new Date().toISOString(),
            diagnostics: {
                flowType: "Elsevier Unified IDP (Modern)",
                hasClientId: !!MENDELEY_CLIENT_ID,
                hasClientSecret: !!MENDELEY_CLIENT_SECRET,
                clientId: MENDELEY_CLIENT_ID.substring(0, 5) + "****",
                callbackUrl: CALLBACK_URL,
                nodeEnv: process.env.NODE_ENV,
                isProduction: process.env.NODE_ENV === "production"
            },
            userStatus: {
                userId: user?.id,
                hasToken: !!user?.mendeley_access_token,
                tokenExpiresAt: user?.mendeley_token_expires_at,
                isExpired: user?.mendeley_token_expires_at ? new Date() > user.mendeley_token_expires_at : null
            }
        });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
/**
 * GET /api/auth/mendeley/folders
 * Fetch user's Mendeley folders
 */
router.get("/folders", rateLimiter_1.providerApiLimiter, hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const userId = req.user.id;
        const folders = await mendeleyService_1.MendeleyService.fetchFolders(userId);
        return res.json(folders);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
/**
 * GET /api/auth/mendeley/folders/:folderId/items
 * Fetch items from a specific Mendeley folder
 */
router.get("/folders/:folderId/items", rateLimiter_1.providerApiLimiter, hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const userId = req.user.id;
        const folderId = req.params.folderId;
        const items = await mendeleyService_1.MendeleyService.fetchFolderItems(userId, folderId);
        return res.json(items);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
/**
 * GET /api/auth/mendeley/callback
 * Handle Elsevier IDP redirect after user authorization
 */
router.get("/callback", oauthCallbackLimiter, async (req, res) => {
    try {
        const code = req.query.code;
        const state = req.query.state;
        const error = req.query.error;
        const error_description = req.query.error_description;
        if (error) {
            console.error("[Mendeley Callback] Elsevier OAuth Error:", { error, error_description });
            return res.status(400).send(`Mendeley/Elsevier Authentication Failed: ${error_description || error}`);
        }
        if (!code || !state) {
            console.error("[Mendeley Callback] Missing required OAuth parameters (code or state)");
            return res.status(400).send("Invalid callback parameters: code and state are required");
        }
        // Validate the CSRF state token and retrieve the associated user ID
        const stateEntry = oauthStateStore.get(state);
        if (!stateEntry) {
            console.error("[Mendeley Callback] Invalid or expired state token");
            return res.status(400).send("OAuth session expired or invalid. Please try connecting again.");
        }
        // Delete immediately to prevent replay
        oauthStateStore.delete(state);
        if (stateEntry.expiresAt < Date.now()) {
            console.error("[Mendeley Callback] State token expired");
            return res.status(400).send("OAuth session expired. Please try connecting again.");
        }
        const userId = stateEntry.userId;
        // Verify user exists before proceeding with token exchange
        const user = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            console.error("[Mendeley Callback] No user found for state/userId:", userId);
            return res.status(404).send("User session invalid or expired during Mendeley sync");
        }
        console.log(`[Mendeley Callback] Exchanging code for token for user: ${userId}`);
        const tokenParams = new URLSearchParams();
        tokenParams.append("grant_type", "authorization_code");
        tokenParams.append("code", code);
        tokenParams.append("redirect_uri", CALLBACK_URL);
        // Elsevier IDP requires HTTP Basic Auth (client_id:client_secret in base64)
        const basicAuth = Buffer.from(`${MENDELEY_CLIENT_ID}:${MENDELEY_CLIENT_SECRET}`).toString("base64");
        const response = await axios_1.default.post(TOKEN_URL, tokenParams.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
                "Authorization": `Basic ${basicAuth}`,
            },
        });
        const { access_token, refresh_token, expires_in } = response.data;
        if (!access_token) {
            console.error("[Mendeley Callback] Token exchange succeeded but no access_token was returned:", response.data);
            throw new Error("Mendeley/Elsevier returned an empty access token");
        }
        // Access tokens typically expire in 3600 seconds (1 hour)
        const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: {
                mendeley_access_token: access_token,
                mendeley_refresh_token: refresh_token || null,
                mendeley_token_expires_at: expiresAt,
            }
        });
        console.log(`[Mendeley Callback] Connection successful. Linked Mendeley account to user ${userId}`);
        // Return to dashboard with success status
        // Determine redirect target (default to production app if not inferred)
        const frontendUrl = process.env.FRONTEND_URL || (process.env.NODE_ENV === "production" ? "https://app.colabwize.com" : "http://localhost:5173");
        return res.redirect(`${frontendUrl}/dashboard/settings/account?mendeley_success=true`);
    }
    catch (error) {
        const errorData = error.response?.data;
        const statusCode = error.response?.status || 500;
        console.error("[Mendeley Callback] Token Exchange Failed:", {
            status: statusCode,
            message: error.message,
            data: errorData
        });
        const errorMessage = errorData?.error_description || errorData?.message || error.message;
        return res.status(statusCode).send(`Mendeley Token Exchange Failed: ${errorMessage}`);
    }
});
/**
 * POST /api/auth/mendeley/disconnect
 * Revoke Mendeley tokens with Elsevier, then clear locally
 */
router.post("/disconnect", hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const userId = req.user.id;
        // Fetch current access token to revoke with Elsevier
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: userId },
            select: { mendeley_access_token: true },
        });
        if (user?.mendeley_access_token) {
            try {
                const accessToken = user.mendeley_access_token;
                const revokeRes = await fetch(`https://api.mendeley.com/oauth/revoke?token=${encodeURIComponent(accessToken)}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Authorization": `Basic ${Buffer.from(`${MENDELEY_CLIENT_ID}:${MENDELEY_CLIENT_SECRET}`).toString("base64")}`,
                    },
                });
                if (!revokeRes.ok) {
                    console.warn(`[Mendeley Auth] Token revocation returned ${revokeRes.status}, clearing locally anyway`);
                }
                else {
                    console.log(`[Mendeley Auth] Token revoked with Elsevier for user ${userId}`);
                }
            }
            catch (revokeErr) {
                console.warn("[Mendeley Auth] Token revocation failed, clearing locally anyway:", revokeErr);
            }
        }
        // Clear tokens locally regardless of revocation result
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: {
                mendeley_access_token: null,
                mendeley_refresh_token: null,
                mendeley_token_expires_at: null,
                mendeley_auto_sync: false,
            },
        });
        logger_1.default.info(`[Mendeley Auth] Disconnected Mendeley for user ${userId}`);
        res.json({ success: true, message: "Mendeley disconnected" });
    }
    catch (error) {
        console.error("[Mendeley Disconnect] Error:", error.message);
        res.status(500).json({ error: "Failed to disconnect Mendeley" });
    }
});
exports.default = router;
