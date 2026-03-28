import express from "express";
import axios from "axios";
import { prisma } from "../../lib/prisma";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";

const router = express.Router();

const MENDELEY_CLIENT_ID = (process.env.MENDELEY_CLIENT_ID || "").trim();
const MENDELEY_CLIENT_SECRET = (process.env.MENDELEY_CLIENT_SECRET || "").trim();
// Modern Elsevier Unified IDP Endpoints
const AUTHORIZE_URL = "https://api.elsevier.com/authenticate";
const TOKEN_URL = "https://api.elsevier.com/token";

// Redirect URI for production (Vercel/API domain)
const CALLBACK_URL = "https://api.colabwize.com/api/auth/mendeley/callback";

/**
 * GET /api/auth/mendeley/connect
 * Initiate Elsevier/Mendeley OAuth flow
 */
router.get("/connect", authenticateHybridRequest, async (req, res) => {
    try {
        const userId = (req as any).user.id;
        console.log("[Mendeley Connect] Redirecting to Elsevier IDP for user:", userId);

        const authUrl = new URL(AUTHORIZE_URL);
        authUrl.searchParams.append("response_type", "code");
        authUrl.searchParams.append("client_id", MENDELEY_CLIENT_ID);
        authUrl.searchParams.append("redirect_uri", CALLBACK_URL);
        authUrl.searchParams.append("scope", "all"); 
        authUrl.searchParams.append("state", userId);

        return res.redirect(authUrl.toString());
    } catch (error) {
        console.error("[Mendeley Connect] Error:", error);
        return res.redirect(`https://app.colabwize.com/dashboard/settings/account?mendeley_error=initiation_failed`);
    }
});

/**
 * POST /api/auth/mendeley/link
 * Link a project to use Mendeley library
 */
router.post("/link", authenticateHybridRequest, async (req, res) => {
    try {
        const { projectId } = req.body;
        if (!projectId) return res.status(400).json({ error: "projectId is required" });

        await prisma.project.update({
            where: { id: projectId },
            data: { linked_library: "mendeley" }
        });

        return res.json({ success: true, message: "Project linked to Mendeley" });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
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
                flowType: "Elsevier Unified IDP",
                hasClientId: !!MENDELEY_CLIENT_ID,
                hasClientSecret: !!MENDELEY_CLIENT_SECRET,
                clientIdPrefix: MENDELEY_CLIENT_ID.substring(0, 4),
                callbackUrl: CALLBACK_URL,
                nodeEnv: process.env.NODE_ENV,
                authUrl: AUTHORIZE_URL,
                tokenUrl: TOKEN_URL
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
 * Handle Elsevier IDP redirect
 */
router.get("/callback", async (req, res) => {
    console.log("[Mendeley Callback] Handling Elsevier IDP callback...", { query: req.query });
    try {
        const { code, state, error } = req.query;

        if (error) {
            console.error("[Mendeley Callback] Elsevier Error:", error);
            return res.status(400).send(`Elsevier authentication error: ${error}`);
        }

        if (!code || !state) {
            console.error("[Mendeley Callback] Invalid parameters:", { code: !!code, state: !!state });
            return res.status(400).send("Invalid callback parameters");
        }

        const userId = state as string;
        
        // Verify user exists
        const userExists = await prisma.user.findUnique({ where: { id: userId } });
        if (!userExists) {
            console.error("[Mendeley Callback] User not found:", userId);
            return res.status(404).send("User not found during sync");
        }

        const tokenParams = new URLSearchParams();
        tokenParams.append("grant_type", "authorization_code");
        tokenParams.append("code", code as string);
        tokenParams.append("redirect_uri", CALLBACK_URL);
        tokenParams.append("client_id", MENDELEY_CLIENT_ID);
        tokenParams.append("client_secret", MENDELEY_CLIENT_SECRET);

        console.log("[Mendeley Callback] Exchanging code via Elsevier Token Endpoint...", { 
            url: TOKEN_URL,
            clientId: MENDELEY_CLIENT_ID 
        });

        const response = await axios.post(TOKEN_URL, tokenParams.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
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
