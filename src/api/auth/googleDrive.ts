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

// Scopes for Google Drive (Read-only for now, can be expanded)
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * GET /api/auth/google/connect
 * Redirect to Google OAuth
 */
router.get("/connect", authenticateHybridRequest, (req, res) => {
  const oauth2Client = getOAuth2Client();
  const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
  const REDIRECT_URI = `${BACKEND_URL}/api/auth/google/callback`;

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: (req as any).user.id, // Store user ID in state for the callback
    redirect_uri: REDIRECT_URI, // Explicitly pass redirect_uri
  });

  console.log(`[Google Auth] Initiating connection. Redirect URI: ${REDIRECT_URI}`);
  res.redirect(url);
});

/**
 * GET /api/auth/google/callback
 * Handle Google OAuth callback
 */
router.get("/callback", async (req, res) => {
  const { code, state: userId } = req.query;

  if (!code || !userId) {
    return res.status(400).send("Missing code or state");
  }

  const oauth2Client = getOAuth2Client();

  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    
    // Save tokens to user
    await prisma.user.update({
      where: { id: userId as string },
      data: {
        google_access_token: tokens.access_token,
        google_refresh_token: tokens.refresh_token,
        google_token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
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
