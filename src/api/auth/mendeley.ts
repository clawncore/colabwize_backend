import express from "express";
import axios from "axios";
import { prisma } from "../../lib/prisma";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";

const router = express.Router();

const MENDELEY_CLIENT_ID = (process.env.MENDELEY_CLIENT_ID || "").trim();
const MENDELEY_CLIENT_SECRET = (process.env.MENDELEY_CLIENT_SECRET || "").trim();
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
        console.error("Mendeley Connect Error:", error.message);
        return res.redirect(`https://app.colabwize.com/dashboard/settings/profile?error=mendeley_connect_failed`);
    }
});

/**
 * GET /api/auth/mendeley/debug
 * Diagnostic endpoint for Mendeley integration
 */
router.get("/debug", authenticateHybridRequest, async (req, res) => {
    try {
        const userId = (req as any).user.id;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { 
                id: true, 
                mendeley_access_token: true,
                mendeley_token_expires_at: true 
            }
        });

        return res.json({
            status: "success",
            diagnostics: {
                hasClientId: !!MENDELEY_CLIENT_ID,
                hasClientSecret: !!MENDELEY_CLIENT_SECRET,
                clientIdPrefix: MENDELEY_CLIENT_ID.substring(0, 4),
                callbackUrl: CALLBACK_URL,
                nodeEnv: process.env.NODE_ENV,
            },
            userStatus: {
                userId: user?.id,
                hasToken: !!user?.mendeley_access_token,
                tokenExpiresAt: user?.mendeley_token_expires_at,
            }
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/auth/mendeley/callback
 * Handle Mendeley redirect
 */
router.get("/callback", async (req, res) => {
    console.log("[Mendeley Callback] Handling callback...", { query: req.query });
    try {
        const { code, state, error } = req.query;

        if (error) {
            console.error("[Mendeley Callback] OAuth Error from Mendeley:", error);
            return res.status(400).send(`Mendeley authentication error: ${error}`);
        }

        if (!code || !state) {
            console.error("[Mendeley Callback] Invalid parameters:", { code: !!code, state: !!state });
            return res.status(400).send("Invalid callback parameters");
        }

        // state contains the user ID
        const userId = state as string;
        
        // Verify user exists in Prisma before proceeding
        const userExists = await prisma.user.findUnique({ where: { id: userId } });
        if (!userExists) {
            console.error("[Mendeley Callback] User not found in database for ID:", userId);
            return res.status(404).send("User not found during authentication sync");
        }

        const credentialsBase64 = Buffer.from(`${MENDELEY_CLIENT_ID}:${MENDELEY_CLIENT_SECRET}`).toString("base64");
        const authHeader = `Basic ${credentialsBase64}`;

        const tokenParams = new URLSearchParams();
        tokenParams.append("grant_type", "authorization_code");
        tokenParams.append("code", code as string);
        tokenParams.append("redirect_uri", CALLBACK_URL);
        tokenParams.append("client_id", MENDELEY_CLIENT_ID);
        tokenParams.append("client_secret", MENDELEY_CLIENT_SECRET);

        console.log("[Mendeley Callback] Exchanging code for token...", { 
            redirect_uri: CALLBACK_URL,
            userId,
            code: (code as string).substring(0, 5) + "..."
        });

        const response = await axios.post("https://api.mendeley.com/oauth/token", tokenParams.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": authHeader,
            },
        });

        const { access_token, refresh_token, expires_in } = response.data;

        if (!access_token) {
            console.error("[Mendeley Callback] No access_token in Mendeley response:", response.data);
            throw new Error("Mendeley returned successful status but no access_token");
        }

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
        
        console.log("[Mendeley Callback] Token saved successfully for user:", userId);
        return res.redirect(`https://app.colabwize.com/dashboard/settings/account?mendeley_success=true`);

    } catch (error: any) {
        const errorData = error.response?.data;
        console.error("[Mendeley Callback] Token Exchange Failed:", {
            message: error.message,
            response: errorData,
            status: error.response?.status
        });
        
        const detailedError = errorData?.error || errorData?.message || error.message;
        return res.status(500).send(`Mendeley authentication failed: ${detailedError}`);
    }
});

export default router;
