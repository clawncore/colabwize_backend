"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const googleapis_1 = require("googleapis");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const crypto_1 = require("crypto");
const hybridAuthMiddleware_1 = require("../../middleware/hybridAuthMiddleware");
const prisma_1 = require("../../lib/prisma");
const tokenCrypto_1 = require("../../services/crypto/tokenCrypto");
/** CSRF state store: maps state token → userId, auto-expires after 10 minutes */
const oauthStateStore = new Map();
/** Clean expired state entries every 5 minutes */
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of oauthStateStore) {
        if (value.expiresAt < now)
            oauthStateStore.delete(key);
    }
}, 5 * 60 * 1000);
function generateState(userId) {
    const state = (0, crypto_1.randomBytes)(32).toString("hex");
    oauthStateStore.set(state, { userId, expiresAt: Date.now() + 10 * 60 * 1000 });
    return state;
}
function validateState(state) {
    const entry = oauthStateStore.get(state);
    if (!entry)
        return null;
    oauthStateStore.delete(state); // one-time use
    if (entry.expiresAt < Date.now())
        return null;
    return entry.userId;
}
const router = express_1.default.Router();
const oauthInitLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    message: { error: "Too many OAuth initiation attempts. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});
const disconnectLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: { error: "Too many disconnect attempts. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});
const oauthCallbackLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20,
    message: { error: "Too many OAuth callback attempts. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});
const getOAuth2Client = () => {
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
    const REDIRECT_URI = `${BACKEND_URL}/api/auth/google/callback`;
    if (!CLIENT_ID || !CLIENT_SECRET) {
        console.error("❌ Google OAuth credentials missing in environment variables");
    }
    return new googleapis_1.google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
};
// Scopes for Google Drive — drive.readonly to list user's documents,
// drive.file to create/edit files via the app
const SCOPES = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
];
/**
 * GET /api/auth/google
 * GET /api/auth/google/connect  <-- Added back for backward compatibility with older frontends
 * Redirect to Google OAuth (Raw Implementation)
 */
const initiateOAuthFlow = (req, res) => {
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
    const REDIRECT_URI = `${BACKEND_URL}/api/auth/google/callback`;
    const userId = req.user.id;
    if (!CLIENT_ID) {
        console.error("❌ GOOGLE_CLIENT_ID missing");
        return res.status(500).send("Server configuration error");
    }
    const scope = encodeURIComponent('https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email');
    const state = generateState(userId);
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;
    console.log(`[Google Auth] Initiating OAuth for user ${userId}. Redirect URI: ${REDIRECT_URI}`);
    res.redirect(url);
};
router.get("/", hybridAuthMiddleware_1.authenticateHybridRequest, oauthInitLimiter, initiateOAuthFlow);
router.get("/connect", hybridAuthMiddleware_1.authenticateHybridRequest, oauthInitLimiter, initiateOAuthFlow);
/**
 * GET /api/auth/google/callback
 * Handle Google OAuth callback
 */
router.get("/callback", oauthCallbackLimiter, async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state) {
        return res.status(400).send("Missing code or state");
    }
    // Validate CSRF state and extract userId
    const userId = validateState(state);
    if (!userId) {
        console.error("[Google Auth] Invalid or expired CSRF state");
        return res.status(400).send("Invalid or expired state. Please try connecting again.");
    }
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
    const REDIRECT_URI = `${BACKEND_URL}/api/auth/google/callback`;
    try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code,
                redirect_uri: REDIRECT_URI,
                grant_type: "authorization_code"
            })
        });
        const tokens = await tokenRes.json();
        if (tokens.error) {
            console.error("Token exchange error:", tokens);
            return res.status(500).send("Failed to exchange OAuth token");
        }
        // Encrypt tokens before storing
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: {
                google_access_token: tokenCrypto_1.TokenCrypto.encrypt(tokens.access_token),
                ...(tokens.refresh_token && {
                    google_refresh_token: tokenCrypto_1.TokenCrypto.encrypt(tokens.refresh_token),
                }),
                google_token_expires_at: tokens.expires_in
                    ? new Date(Date.now() + tokens.expires_in * 1000)
                    : null,
            },
        });
        console.log(`[Google Auth] Connected Drive for user ${userId} (tokens encrypted)`);
        res.send(`
      <html>
        <head><title>Google Drive Connected</title></head>
        <body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8f9fa;">
          <div style="text-align:center;padding:40px;background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:400px;">
            <div style="width:64px;height:64px;background:linear-gradient(135deg,#34a853,#0f9d58);border-radius:50%;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            </div>
            <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:20px;">Google Drive Connected!</h2>
            <p style="color:#666;margin:0 0 20px;font-size:14px;">Your Google Drive has been successfully linked. You can close this window now.</p>
            <button onclick="window.close()" style="background:#0f9d58;color:white;border:none;padding:10px 24px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600;">Close Window</button>
          </div>
          <script>
            (function() {
              try {
                if (window.opener && !window.opener.closed) {
                  window.opener.postMessage({ type: 'GOOGLE_CONNECTED' }, '*');
                  setTimeout(function() { window.close(); }, 500);
                }
              } catch(e) {}
            })();
          </script>
        </body>
      </html>
    `);
    }
    catch (error) {
        console.error("Google Auth Error:", error);
        res.status(500).send("Failed to connect Google Drive");
    }
});
/**
 * POST /api/auth/google/disconnect
 * Revoke Google Drive tokens with Google, then clear locally
 */
router.post("/disconnect", hybridAuthMiddleware_1.authenticateHybridRequest, disconnectLimiter, async (req, res) => {
    try {
        const userId = req.user.id;
        // Fetch the current access token to revoke it with Google
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: userId },
            select: { google_access_token: true },
        });
        if (user?.google_access_token) {
            try {
                const accessToken = tokenCrypto_1.TokenCrypto.decryptOrPlaintext(user.google_access_token);
                // Revoke the token with Google
                const revokeRes = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                });
                if (!revokeRes.ok) {
                    console.warn(`[Google Auth] Token revocation returned ${revokeRes.status}, clearing locally anyway`);
                }
                else {
                    console.log(`[Google Auth] Token revoked with Google for user ${userId}`);
                }
            }
            catch (revokeErr) {
                // Don't fail the disconnect if revocation fails — just log
                console.warn(`[Google Auth] Token revocation failed:`, revokeErr);
            }
        }
        // Clear tokens locally regardless of revocation result
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: {
                google_access_token: null,
                google_refresh_token: null,
                google_token_expires_at: null,
            },
        });
        console.log(`[Google Auth] Disconnected Drive for user ${userId}`);
        res.json({ success: true, message: "Google Drive disconnected" });
    }
    catch (error) {
        console.error("Google Disconnect Error:", error);
        res.status(500).json({ error: "Failed to disconnect Google Drive" });
    }
});
exports.default = router;
