import express from "express";
import rateLimit from "express-rate-limit";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";
import { prisma } from "../../lib/prisma";
import { TokenCrypto } from "../../services/crypto/tokenCrypto";

const router = express.Router();

const oauthInitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many OAuth initiation attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
} as any);

const oauthCallbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: "Too many OAuth callback attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
} as any);

const SCOPES = "openid email profile Files.ReadWrite.All offline_access";

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

  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent&state=${userId}`;

  console.log(`[OneDrive Auth] Initiating OAuth. Redirect URI: ${redirectUri}`);
  res.redirect(authUrl);
});

/**
 * GET /api/auth/onedrive/callback
 * Handle Microsoft OAuth callback
 */
router.get("/callback", oauthCallbackLimiter, async (req, res) => {
  const { code, state: userId } = req.query;

  if (!code || !userId) {
    return res.status(400).send("Missing code or state");
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
      where: { id: userId as string },
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
        <body>
          <script>
            window.opener.postMessage({ type: 'ONEDRIVE_CONNECTED' }, '*');
            window.close();
          </script>
          <p>OneDrive connected successfully! You can close this window now.</p>
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
 * Remove OneDrive tokens
 */
router.post("/disconnect", authenticateHybridRequest, async (req: any, res) => {
  try {
    const userId = req.user.id;
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
