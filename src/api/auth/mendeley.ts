import express from "express";
import axios from "axios";
import { prisma } from "../../lib/prisma";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";

const router = express.Router();

const MENDELEY_CLIENT_ID = process.env.MENDELEY_CLIENT_ID || "";
const MENDELEY_CLIENT_SECRET = process.env.MENDELEY_CLIENT_SECRET || "";
const CALLBACK_URL = "https://api.colabwize.com/api/auth/mendeley/callback";

/**
 * GET /api/auth/mendeley/connect
 * Start OAuth 2.0 flow
 */
router.get("/connect", authenticateHybridRequest, async (req, res) => {
    try {
        const userId = (req as any).user.id;

        const authUrl = new URL("https://api.mendeley.com/oauth/authorize");
        authUrl.searchParams.append("client_id", MENDELEY_CLIENT_ID);
        authUrl.searchParams.append("redirect_uri", CALLBACK_URL);
        authUrl.searchParams.append("response_type", "code");
        authUrl.searchParams.append("scope", "all");
        authUrl.searchParams.append("state", userId); // Use user ID as state to identify them on callback

        return res.redirect(authUrl.toString());
    } catch (error: any) {
        console.error("Mendeley Connect Error:", error.message);
        const frontendUrl = process.env.FRONTEND_URL || "https://app.colabwize.com";
        return res.redirect(`${frontendUrl}/dashboard/settings/profile?error=mendeley_connect_failed`);
    }
});

/**
 * GET /api/auth/mendeley/callback
 * Handle Mendeley redirect
 */
router.get("/callback", async (req, res) => {
    try {
        const { code, state, error } = req.query;

        if (error) {
            console.error("Mendeley OAuth Error:", error);
            return res.status(400).send(`Mendeley authentication error: ${error}`);
        }

        if (!code || !state) {
            return res.status(400).send("Invalid callback parameters");
        }

        // state contains the user ID
        const userId = state as string;

        const tokenData = new URLSearchParams({
            grant_type: "authorization_code",
            code: code as string,
            redirect_uri: CALLBACK_URL,
            client_id: MENDELEY_CLIENT_ID,
            client_secret: MENDELEY_CLIENT_SECRET,
        });

        const response = await axios.post("https://api.mendeley.com/oauth/token", tokenData, {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
        });

        const { access_token, refresh_token, expires_in } = response.data;

        if (!access_token) throw new Error("Failed to exchange authorization code for access token");

        const expiresAt = new Date(Date.now() + expires_in * 1000);

        // Securely save to Prisma
        await prisma.user.update({
            where: { id: userId },
            data: {
                mendeley_access_token: access_token,
                mendeley_refresh_token: refresh_token || null,
                mendeley_token_expires_at: expiresAt,
            }
        });
        
        return res.redirect(`https://app.colabwize.com/dashboard/settings/account?mendeley_success=true`);

    } catch (error: any) {
        console.error("Mendeley Callback Error:", error.response?.data || error.message);
        return res.status(500).send("Mendeley authentication failed");
    }
});

export default router;
