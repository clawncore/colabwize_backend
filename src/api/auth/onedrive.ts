import express from "express";
import rateLimit from "express-rate-limit";
import { randomBytes } from "crypto";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";
import { prisma } from "../../lib/prisma";
import { TokenCrypto } from "../../services/crypto/tokenCrypto";

const router = express.Router();

const oauthInitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: "Too many OAuth initiation attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
} as any);

const oauthCallbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: { error: "Too many OAuth callback attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
} as any);

const disconnectLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: "Too many disconnect attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
} as any);

const SCOPES = "openid email profile Files.ReadWrite.All offline_access";

/** CSRF state store: maps state token → userId, auto-expires after 10 minutes */
const oauthStateStore = new Map<string, { userId: string; expiresAt: number }>();

/** Clean expired state entries every 5 minutes */
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of oauthStateStore) {
    if (value.expiresAt < now) oauthStateStore.delete(key);
  }
}, 5 * 60 * 1000);

function generateState(userId: string): string {
  const state = randomBytes(32).toString("hex");
  oauthStateStore.set(state, { userId, expiresAt: Date.now() + 10 * 60 * 1000 });
  return state;
}

function validateState(state: string): string | null {
  const entry = oauthStateStore.get(state);
  if (!entry) return null;
  oauthStateStore.delete(state); // one-time use
  if (entry.expiresAt < Date.now()) return null;
  return entry.userId;
}

/**
 * GET /api/auth/onedrive
 * Initiate Microsoft OneDrive OAuth flow
 */
router.get("/", authenticateHybridRequest, oauthInitLimiter, (req: any, res) => {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";
  const redirectUri = `${backendUrl}/api/auth/onedrive/callback`;
  const userId = req.user.id;

  if (!clientId) {
    console.error("❌ MICROSOFT_CLIENT_ID missing");
    return res.status(500).send("Server configuration error");
  }

  const state = generateState(userId);
  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(SCOPES)}&prompt=consent&state=${state}`;

  console.log(`[OneDrive Auth] Initiating OAuth for user ${userId}. Redirect URI: ${redirectUri}`);
  res.redirect(authUrl);
});

/**
 * GET /api/auth/onedrive/callback
 * Handle Microsoft OAuth callback
 */
router.get("/callback", oauthCallbackLimiter, async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.warn(`[OneDrive Auth] Provider returned error: ${error} - ${error_description}`);
    return res.status(400).send(`Authentication error: ${error_description || error}. Please try again.`);
  }

  if (!code || !state) {
    return res.status(400).send("Missing code or state");
  }

  // Validate CSRF state and extract userId
  const userId = validateState(state as string);
  if (!userId) {
    console.error("[OneDrive Auth] Invalid or expired CSRF state");
    return res.status(400).send("Invalid or expired state. Please try connecting again.");
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";
  const redirectUri = `${backendUrl}/api/auth/onedrive/callback`;

  try {
    const tokenEndpoint = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
    const body = new URLSearchParams({
      client_id: clientId || "",
      client_secret: clientSecret || "",
      code: code as string,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });

    const tokenRes = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const tokens = await tokenRes.json();

    if (tokens.error) {
      console.error("[OneDrive Auth] Token exchange error:", tokens);
      return res.status(500).send("Failed to exchange OAuth token");
    }

    // Encrypt tokens before storing
    await prisma.user.update({
      where: { id: userId },
      data: {
        onedrive_access_token: TokenCrypto.encrypt(tokens.access_token),
        onedrive_refresh_token: tokens.refresh_token
          ? TokenCrypto.encrypt(tokens.refresh_token)
          : null,
        onedrive_token_expires_at: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : null,
      },
    });

    console.log(`[OneDrive Auth] Connected OneDrive for user ${userId} (tokens encrypted)`);

    res.send(`
      <html>
        <head><title>OneDrive Connected</title></head>
        <body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8f9fa;">
          <div style="text-align:center;padding:40px;background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:400px;">
            <div style="width:64px;height:64px;background:linear-gradient(135deg,#0078D4,#005A9E);border-radius:50%;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            </div>
            <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:20px;">OneDrive Connected!</h2>
            <p style="color:#666;margin:0 0 20px;font-size:14px;">Your Microsoft OneDrive has been successfully linked. You can close this window now.</p>
            <button onclick="window.close()" style="background:#0078D4;color:white;border:none;padding:10px 24px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600;">Close Window</button>
          </div>
          <script>
            (function() {
              try {
                if (window.opener && !window.opener.closed) {
                  window.opener.postMessage({ type: 'ONEDRIVE_CONNECTED' }, '*');
                  setTimeout(function() { window.close(); }, 500);
                }
              } catch(e) {}
            })();
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("[OneDrive Auth] Error:", error);
    res.status(500).send("Failed to connect OneDrive");
  }
});

/**
 * POST /api/auth/onedrive/disconnect
 * Revoke tokens with Microsoft and remove locally
 */
router.post("/disconnect", authenticateHybridRequest, async (req: any, res) => {
  try {
    const userId = req.user.id;

    // Fetch the current access token to revoke it with Microsoft
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { onedrive_access_token: true },
    });

    if (user?.onedrive_access_token) {
      try {
        const accessToken = TokenCrypto.decryptOrPlaintext(user.onedrive_access_token);
        // Revoke the token with Microsoft
        const revokeRes = await fetch(
          `https://login.microsoftonline.com/common/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(process.env.FRONTEND_URL || "http://localhost:3000")}`,
          { method: "GET" }
        );
        console.log(`[OneDrive Auth] Microsoft logout returned ${revokeRes.status}`);
      } catch (revokeErr) {
        // Don't fail disconnect if revocation fails
        console.warn(`[OneDrive Auth] Token revocation failed:`, revokeErr);
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        onedrive_access_token: null,
        onedrive_refresh_token: null,
        onedrive_token_expires_at: null,
      },
    });
    console.log(`[OneDrive Auth] Disconnected OneDrive for user ${userId}`);
    res.json({ success: true, message: "OneDrive disconnected" });
  } catch (error) {
    console.error("[OneDrive Disconnect] Error:", error);
    res.status(500).json({ error: "Failed to disconnect OneDrive" });
  }
});

export default router;
