import express from "express";
import { google } from "googleapis";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";
import { prisma } from "../../lib/prisma";

const router = express.Router();

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

router.get("/", authenticateHybridRequest, initiateOAuthFlow);
router.get("/connect", authenticateHybridRequest, initiateOAuthFlow);

/**
 * GET /api/auth/google/callback
 * Handle Google OAuth callback
 */
router.get("/callback", async (req, res) => {
  const { code, state: userId } = req.query;

  if (!code || !userId) {
    return res.status(400).send("Missing code or state");
  }

  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
  const REDIRECT_URI = `${BACKEND_URL}/api/auth/google/callback`;

  try {
    // Exact token exchange requested by user:
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

    // Save tokens to user
    await prisma.user.update({
      where: { id: userId as string },
      data: {
        google_access_token: tokens.access_token,
        ...(tokens.refresh_token && { google_refresh_token: tokens.refresh_token }),
        google_token_expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      },
    });

    // Close window if it was a popup, or redirect to settings
    res.send(`
      <html>
        <body>
          <script>
            window.opener.postMessage({ type: 'GOOGLE_CONNECTED' }, '*');
            window.close();
          </script>
          <p>Google Drive connected successfully! You can close this window now.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Google Auth Error:", error);
    res.status(500).send("Failed to connect Google Drive");
  }
});

export default router;
