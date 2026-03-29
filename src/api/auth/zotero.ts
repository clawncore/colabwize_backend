import express from "express";
import crypto from "crypto";
import axios from "axios";
import { prisma } from "../../lib/prisma.js";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware.js";
import logger from "../../monitoring/logger";

const router = express.Router();

const ZOTERO_CLIENT_KEY = process.env.ZOTERO_CLIENT_KEY || "";
const ZOTERO_CLIENT_SECRET = process.env.ZOTERO_CLIENT_SECRET || "";

// Dynamic Redirect URI based on environment
const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:3001").replace(/\/$/, "");
const CALLBACK_URL = `${BACKEND_URL}/api/auth/zotero/callback`;

// In-memory store for oauth_token_secret, mapping user ID to secret
const requestTokenSecrets = new Map<string, string>();

// Helper to generate OAuth 1.0a signature
function generateOAuthSignature(method: string, url: string, params: Record<string, string>, clientSecret: string, tokenSecret: string = "") {
    const sortedKeys = Object.keys(params).sort();
    const paramString = sortedKeys.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`).join("&");
    
    const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
    const signingKey = `${encodeURIComponent(clientSecret)}&${encodeURIComponent(tokenSecret)}`;
    
    return crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");
}

/**
 * GET /api/auth/zotero/connect
 * Start OAuth 1.0a flow
 */
router.get("/connect", authenticateHybridRequest, async (req, res) => {
    try {
        const userId = (req as any).user.id;
        const nonce = crypto.randomBytes(16).toString("hex");
        const timestamp = Math.floor(Date.now() / 1000).toString();

        // Append CW User ID to callback to identify user on return
        const callbackWithUid = `${CALLBACK_URL}?cw_uid=${userId}`;

        const params: Record<string, string> = {
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

        const response = await axios.get("https://www.zotero.org/oauth/request", {
            headers: { Authorization: authHeader }
        });

        // Response is form-encoded: oauth_token=...&oauth_token_secret=...&oauth_callback_confirmed=true
        const data = new URLSearchParams(response.data);
        const oauthToken = data.get("oauth_token");
        const oauthTokenSecret = data.get("oauth_token_secret");
        
        if (!oauthToken || !oauthTokenSecret) throw new Error("Failed to get request token from Zotero");

        requestTokenSecrets.set(userId, oauthTokenSecret);

        // Redirect user to Zotero for authorization
        return res.redirect(`https://www.zotero.org/oauth/authorize?oauth_token=${oauthToken}`);
    } catch (error: any) {
        console.error("Zotero Connect Error:", error.message);
        return res.redirect(`https://app.colabwize.com/dashboard/settings/profile?error=zotero_connect_failed`);
    }
});

/**
 * GET /api/auth/zotero/callback
 * Handle Zotero redirect
 */
router.get("/callback", async (req, res) => {
    try {
        const { oauth_token, oauth_verifier, cw_uid } = req.query;

        if (!oauth_token || !oauth_verifier || !cw_uid) {
            return res.status(400).send("Invalid callback parameters");
        }

        const nonce = crypto.randomBytes(16).toString("hex");
        const timestamp = Math.floor(Date.now() / 1000).toString();

        const params: Record<string, string> = {
            oauth_consumer_key: ZOTERO_CLIENT_KEY,
            oauth_nonce: nonce,
            oauth_signature_method: "HMAC-SHA1",
            oauth_timestamp: timestamp,
            oauth_token: oauth_token as string,
            oauth_verifier: oauth_verifier as string,
            oauth_version: "1.0"
        };

        const oauthTokenSecret = requestTokenSecrets.get(cw_uid as string) || "";
        requestTokenSecrets.delete(cw_uid as string);

        const signature = generateOAuthSignature("GET", "https://www.zotero.org/oauth/access", params, ZOTERO_CLIENT_SECRET, oauthTokenSecret);
        params.oauth_signature = signature;

        const authHeader = "OAuth " + Object.keys(params).map(key => `${encodeURIComponent(key)}="${encodeURIComponent(params[key])}"`).join(", ");

        const response = await axios.get("https://www.zotero.org/oauth/access", {
            headers: { Authorization: authHeader }
        });

        // Response: oauth_token=<API_KEY>&oauth_token_secret=<N/A>&username=<NAME>&userID=<ID>
        const data = new URLSearchParams(response.data);
        const apiKey = data.get("oauth_token");
        const zoteroUserId = data.get("userID");

        if (!apiKey || !zoteroUserId) throw new Error("Failed to exchange access token");

        // Securely save to Prisma
        await prisma.user.update({
            where: { id: cw_uid as string },
            data: {
                zotero_api_key: apiKey,
                zotero_user_id: zoteroUserId
            }
        });
        
        // Determine redirect target (default to production app if not inferred)
        const frontendUrl = (req.headers.referer || "https://app.colabwize.com").split("/dashboard")[0];
        
        return res.redirect(`${frontendUrl}/dashboard/settings/account?zotero_success=true`);

    } catch (error: any) {
        console.error("Zotero Callback Error:", error.response?.data || error.message);
        return res.status(500).send("Zotero authentication failed");
    }
});

export default router;
