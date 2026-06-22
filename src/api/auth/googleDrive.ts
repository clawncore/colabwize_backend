import express from "express";
import { google } from "googleapis";
import rateLimit from "express-rate-limit";
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

const getOAuth2Client = () => {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
  const REDIRECT_URI = `${BACKEND_URL}/api/auth/google/callback`;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("❌ Google OAuth credentials missing in environment variables");
  }

  return new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
  );
};

// Scopes for Google Drive (Allowing file creation/export)
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * GET /api/auth/google
 * GET /api/auth/google/connect  <-- Added back for backward compatibility with older frontends
 * Redirect to Google OAuth (Raw Implementation)
 */
const initiateOAuthFlow = (req: any, res: any) => {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
  const REDIRECT_URI = `${BACKEND_URL}/api/auth/google/callback`;
  const userId = req.user.id;

  if (!CLIENT_ID) {
    console.error("❌ GOOGLE_CLIENT_ID missing");
    return res.status(500).send("Server configuration error");
  }

  // Exact flow requested by user:
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=https://www.googleapis.com/auth/drive.file%20https://www.googleapis.com/auth/userinfo.email&access_type=offline&prompt=consent&state=${userId}`;

  console.log(`[Google Auth] Initiating raw connection (write-access). Redirect URI: ${REDIRECT_URI}`);
  res.redirect(url);
};

router.get("/", authenticateHybridRequest, oauthInitLimiter, initiateOAuthFlow);
router.get("/connect", authenticateHybridRequest, oauthInitLimiter, initiateOAuthFlow);

/**
 * GET /api/auth/google/callback
 * Handle Google OAuth callback
 */
router.get("/callback", oauthCallbackLimiter, async (req, res) => {
  const { code, state: userId } = req.query;

  if (!code || !userId) {
    return res.status(400).send("Missing code or state");
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
    await prisma.user.update({
      where: { id: userId as string },
      data: {
        google_access_token: TokenCrypto.encrypt(tokens.access_token),
        ...(tokens.refresh_token && {
          google_refresh_token: TokenCrypto.encrypt(tokens.refresh_token),
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
  } catch (error) {
    console.error("Google Auth Error:", error);
    res.status(500).send("Failed to connect Google Drive");
  }
});

/**
 * POST /api/auth/google/disconnect
 * Revoke and remove Google Drive tokens
 */
router.post("/disconnect", authenticateHybridRequest, async (req: any, res) => {
  try {
    const userId = req.user.id;
    await prisma.user.update({
      where: { id: userId },
      data: {
        google_access_token: null,
        google_refresh_token: null,
        google_token_expires_at: null,
      },
    });
    console.log(`[Google Auth] Disconnected Drive for user ${userId}`);
    res.json({ success: true, message: "Google Drive disconnected" });
  } catch (error) {
    console.error("Google Disconnect Error:", error);
    res.status(500).json({ error: "Failed to disconnect Google Drive" });
  }
});

export default router;
