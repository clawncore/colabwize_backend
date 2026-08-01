"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const axios_1 = __importDefault(require("axios"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const prisma_js_1 = require("../../lib/prisma.js");
const hybridAuthMiddleware_js_1 = require("../../middleware/hybridAuthMiddleware.js");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const router = express_1.default.Router();
const ZOTERO_CLIENT_KEY = process.env.ZOTERO_CLIENT_KEY || "";
const ZOTERO_CLIENT_SECRET = process.env.ZOTERO_CLIENT_SECRET || "";
// Dynamic Redirect URI based on environment
const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:3001").replace(/\/$/, "");
const CALLBACK_URL = `${BACKEND_URL}/api/auth/zotero/callback`;
/**
 * In-memory store for Zotero OAuth 1.0a token secrets.
 * Maps userId → { secret, oauthToken, expiresAt }.
 * Entries auto-expire after 10 minutes.
 */
const requestTokenSecrets = new Map();
/** Clean expired entries every 5 minutes */
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of requestTokenSecrets) {
        if (value.expiresAt < now)
            requestTokenSecrets.delete(key);
    }
}, 5 * 60 * 1000);
/** Rate limiters for Zotero OAuth endpoints */
const oauthInitLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: "Too many Zotero OAuth initiation attempts. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});
const oauthCallbackLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: 20,
    message: { error: "Too many Zotero OAuth callback attempts. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});
// Helper to generate OAuth 1.0a signature
function generateOAuthSignature(method, url, params, clientSecret, tokenSecret = "") {
    const sortedKeys = Object.keys(params).sort();
    const paramString = sortedKeys.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`).join("&");
    const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
    const signingKey = `${encodeURIComponent(clientSecret)}&${encodeURIComponent(tokenSecret)}`;
    return crypto_1.default.createHmac("sha1", signingKey).update(baseString).digest("base64");
}
/**
 * GET /api/auth/zotero/connect
 * Start OAuth 1.0a flow
 */
router.get("/connect", oauthInitLimiter, hybridAuthMiddleware_js_1.authenticateHybridRequest, async (req, res) => {
    try {
        const userId = req.user.id;
        const nonce = crypto_1.default.randomBytes(16).toString("hex");
        const timestamp = Math.floor(Date.now() / 1000).toString();
        // Append CW User ID to callback to identify user on return
        const callbackWithUid = `${CALLBACK_URL}?cw_uid=${userId}`;
        const params = {
            oauth_callback: callbackWithUid,
            oauth_consumer_key: ZOTERO_CLIENT_KEY,
            oauth_nonce: nonce,
            oauth_signature_method: "HMAC-SHA1",
            oauth_timestamp: timestamp,
            oauth_version: "1.0"
        };
        const signature = generateOAuthSignature("GET", "https://www.zotero.org/oauth/request", params, ZOTERO_CLIENT_SECRET);
        params.oauth_signature = signature;
        const authHeader = "OAuth " + Object.keys(params).map(key => `${encodeURIComponent(key)}="${encodeURIComponent(params[key])}"`).join(", ");
        const response = await axios_1.default.get("https://www.zotero.org/oauth/request", {
            headers: { Authorization: authHeader }
        });
        // Response is form-encoded: oauth_token=...&oauth_token_secret=...&oauth_callback_confirmed=true
        const data = new URLSearchParams(response.data);
        const oauthToken = data.get("oauth_token");
        const oauthTokenSecret = data.get("oauth_token_secret");
        if (!oauthToken || !oauthTokenSecret)
            throw new Error("Failed to get request token from Zotero");
        // Store secret + token + expiry (10 minutes) to validate binding on callback
        requestTokenSecrets.set(userId, {
            secret: oauthTokenSecret,
            oauthToken,
            expiresAt: Date.now() + 10 * 60 * 1000,
        });
        logger_1.default.info(`[Zotero Connect] OAuth request token obtained for user: ${userId}`);
        // Redirect user to Zotero for authorization
        return res.redirect(`https://www.zotero.org/oauth/authorize?oauth_token=${oauthToken}`);
    }
    catch (error) {
        console.error("[Zotero Connect] Error:", error.message);
        return res.redirect(`${process.env.FRONTEND_URL || "https://app.colabwize.com"}/dashboard/settings/profile?error=zotero_connect_failed`);
    }
});
/**
 * GET /api/auth/zotero/callback
 * Handle Zotero redirect
 */
router.get("/callback", oauthCallbackLimiter, async (req, res) => {
    try {
        const { oauth_token, oauth_verifier, cw_uid } = req.query;
        if (!oauth_token || !oauth_verifier || !cw_uid) {
            return res.status(400).send("Invalid callback parameters");
        }
        // Look up the stored secret and validate token↔user binding
        const stored = requestTokenSecrets.get(cw_uid);
        if (!stored) {
            console.error("[Zotero Callback] No pending OAuth session for user:", cw_uid);
            return res.status(400).send("OAuth session expired or invalid. Please try connecting again.");
        }
        requestTokenSecrets.delete(cw_uid);
        if (stored.expiresAt < Date.now()) {
            console.error("[Zotero Callback] OAuth session expired for user:", cw_uid);
            return res.status(400).send("OAuth session expired. Please try connecting again.");
        }
        // Token binding check: the oauth_token from Zotero must match the one we issued
        if (stored.oauthToken !== oauth_token) {
            console.error("[Zotero Callback] Token mismatch — possible session hijack attempt");
            return res.status(400).send("OAuth session validation failed. Please try connecting again.");
        }
        const nonce = crypto_1.default.randomBytes(16).toString("hex");
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const params = {
            oauth_consumer_key: ZOTERO_CLIENT_KEY,
            oauth_nonce: nonce,
            oauth_signature_method: "HMAC-SHA1",
            oauth_timestamp: timestamp,
            oauth_token: oauth_token,
            oauth_verifier: oauth_verifier,
            oauth_version: "1.0"
        };
        const signature = generateOAuthSignature("GET", "https://www.zotero.org/oauth/access", params, ZOTERO_CLIENT_SECRET, stored.secret);
        params.oauth_signature = signature;
        const authHeader = "OAuth " + Object.keys(params).map(key => `${encodeURIComponent(key)}="${encodeURIComponent(params[key])}"`).join(", ");
        const response = await axios_1.default.get("https://www.zotero.org/oauth/access", {
            headers: { Authorization: authHeader }
        });
        // Response: oauth_token=<API_KEY>&oauth_token_secret=<N/A>&username=<NAME>&userID=<ID>
        const data = new URLSearchParams(response.data);
        const apiKey = data.get("oauth_token");
        const zoteroUserId = data.get("userID");
        if (!apiKey || !zoteroUserId)
            throw new Error("Failed to exchange access token");
        // Securely save to Prisma
        await prisma_js_1.prisma.user.update({
            where: { id: cw_uid },
            data: {
                zotero_api_key: apiKey,
                zotero_user_id: zoteroUserId
            }
        });
        // Determine redirect target (default to production app if not inferred)
        const frontendUrl = process.env.FRONTEND_URL || (process.env.NODE_ENV === "production" ? "https://app.colabwize.com" : "http://localhost:5173");
        return res.redirect(`${frontendUrl}/dashboard/settings/account?zotero_success=true`);
    }
    catch (error) {
        console.error("[Zotero Callback] Error:", error.response?.data || error.message);
        return res.status(500).send("Zotero authentication failed");
    }
});
/**
 * POST /api/auth/zotero/disconnect
 * Clear Zotero tokens and user association
 */
router.post("/disconnect", hybridAuthMiddleware_js_1.authenticateHybridRequest, async (req, res) => {
    try {
        const userId = req.user.id;
        // Revoke OAuth tokens by clearing them locally
        // Zotero API keys don't support server-side revocation,
        // so we clear the stored credentials
        await prisma_js_1.prisma.user.update({
            where: { id: userId },
            data: {
                zotero_api_key: null,
                zotero_user_id: null,
                zotero_auto_sync: false,
            },
        });
        logger_1.default.info(`[Zotero Auth] Disconnected Zotero for user ${userId}`);
        res.json({ success: true, message: "Zotero disconnected" });
    }
    catch (error) {
        console.error("[Zotero Disconnect] Error:", error.message);
        res.status(500).json({ error: "Failed to disconnect Zotero" });
    }
});
exports.default = router;
