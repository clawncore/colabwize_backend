import express from "express";
import axios from "axios";
import { prisma } from "../../lib/prisma";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";
import { MendeleyService } from "../../services/mendeleyService";
import logger from "../../monitoring/logger";

console.log("[DEBUG] Mendeley file script executing...");
logger.info("[CRITICAL_DIAGNOSTIC] Mendeley Auth Route File Loaded");

const router = express.Router();

const MENDELEY_CLIENT_ID = (process.env.MENDELEY_CLIENT_ID || "").trim();
const MENDELEY_CLIENT_SECRET = (process.env.MENDELEY_CLIENT_SECRET || "").trim();
const MENDELEY_API_KEY = (process.env.MENDELEY_API_KEY || MENDELEY_CLIENT_SECRET || "MISSING_KEY").trim(); 
// Standard Mendeley OAuth Endpoints
const AUTHORIZE_URL = "https://api.mendeley.com/oauth/authorize";
const TOKEN_URL = "https://api.mendeley.com/oauth/token";

// Dynamic Redirect URI based on environment
const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:3001").replace(/\/$/, "");
const CALLBACK_URL = `${BACKEND_URL}/api/auth/mendeley/callback`;

/**
 * GET /api/auth/mendeley/connect
 * Initiate Elsevier/Mendeley OAuth flow
 */
router.get("/connect", authenticateHybridRequest, async (req, res) => {
    try {
        const userId = (req as any).user.id;
        logger.info(`[DIAGNOSTIC] Mendeley Connect - User: ${userId}`);
        logger.info(`[DIAGNOSTIC] Mendeley Connect - Client ID: ${MENDELEY_CLIENT_ID}`);
        logger.info(`[DIAGNOSTIC] Mendeley Connect - API Key: ${MENDELEY_API_KEY}`);

        // Use the Mendeley OAuth flow
        const authUrl = new URL(AUTHORIZE_URL);
        authUrl.searchParams.append("response_type", "code");
        authUrl.searchParams.append("client_id", MENDELEY_CLIENT_ID);
        authUrl.searchParams.append("redirect_uri", CALLBACK_URL);
        authUrl.searchParams.append("scope", "all"); 
        authUrl.searchParams.append("state", userId);

        logger.info(`[DIAGNOSTIC] Mendeley Connect - Final Auth URL: ${authUrl.toString()}`);
        
        return res.redirect(authUrl.toString());
    } catch (error: any) {
        console.error("[Mendeley Connect] Fatal Error:", error.message);
        return res.redirect(`https://app.colabwize.com/dashboard/settings/account?mendeley_error=initiation_failed&details=${encodeURIComponent(error.message)}`);
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
        console.error("[Mendeley Link] Error:", error.message);
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
            timestamp: new Date().toISOString(),
            diagnostics: {
                flowType: "Elsevier Unified IDP (Modern)",
                hasClientId: !!MENDELEY_CLIENT_ID,
                hasClientSecret: !!MENDELEY_CLIENT_SECRET,
                clientId: MENDELEY_CLIENT_ID.substring(0, 5) + "****",
                callbackUrl: CALLBACK_URL,
                nodeEnv: process.env.NODE_ENV,
                isProduction: process.env.NODE_ENV === "production"
            },
            userStatus: {
                userId: user?.id,
                hasToken: !!user?.mendeley_access_token,
                tokenExpiresAt: user?.mendeley_token_expires_at,
                isExpired: user?.mendeley_token_expires_at ? new Date() > user.mendeley_token_expires_at : null
            }
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/auth/mendeley/folders
 * Fetch user's Mendeley folders
 */
router.get("/folders", authenticateHybridRequest, async (req, res) => {
    try {
        const userId = (req as any).user.id;
        const folders = await MendeleyService.fetchFolders(userId);
        return res.json(folders);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/auth/mendeley/folders/:folderId/items
 * Fetch items from a specific Mendeley folder
 */
router.get("/folders/:folderId/items", authenticateHybridRequest, async (req, res) => {
    try {
        const userId = (req as any).user.id;
        const folderId = req.params.folderId as string;
        const items = await MendeleyService.fetchFolderItems(userId, folderId);
        return res.json(items);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/auth/mendeley/callback
 * Handle Elsevier IDP redirect after user authorization
 */
router.get("/callback", async (req, res) => {
    console.log("[Mendeley Callback] Received callback from Elsevier IDP");
    
    try {
        const code = req.query.code as string;
        const state = req.query.state as string;
        const error = req.query.error as string;
        const error_description = req.query.error_description as string;

        if (error) {
            console.error("[Mendeley Callback] Elsevier OAuth Error:", { error, error_description });
            return res.status(400).send(`Mendeley/Elsevier Authentication Failed: ${error_description || error}`);
        }

        if (!code || !state) {
            console.error("[Mendeley Callback] Missing required OAuth parameters (code or state)");
            return res.status(400).send("Invalid callback parameters: code and state (userId) are required");
        }

        const userId = state as string;
        
        // Verify user exists before proceeding with token exchange
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            console.error("[Mendeley Callback] No user found for state/userId:", userId);
            return res.status(404).send("User session invalid or expired during Mendeley sync");
        }

        console.log(`[Mendeley Callback] Exchanging code for token for user: ${userId}`);

        const tokenParams = new URLSearchParams();
        tokenParams.append("grant_type", "authorization_code");
        tokenParams.append("code", code as string);
        tokenParams.append("redirect_uri", CALLBACK_URL);
        tokenParams.append("client_id", MENDELEY_CLIENT_ID);
        tokenParams.append("client_secret", MENDELEY_CLIENT_SECRET);

        const response = await axios.post(TOKEN_URL, tokenParams.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
                "X-ELS-APIKey": MENDELEY_API_KEY 
            },
        });

        const { access_token, refresh_token, expires_in } = response.data;

        if (!access_token) {
            console.error("[Mendeley Callback] Token exchange succeeded but no access_token was returned:", response.data);
            throw new Error("Mendeley/Elsevier returned an empty access token");
        }

        // Access tokens typically expire in 3600 seconds (1 hour)
        const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);

        await prisma.user.update({
            where: { id: userId },
            data: {
                mendeley_access_token: access_token,
                mendeley_refresh_token: refresh_token || null,
                mendeley_token_expires_at: expiresAt,
            }
        });
        
        console.log(`[Mendeley Callback] Connection successful. Linked Mendeley account to user ${userId}`);
        
        // Return to dashboard with success status
        // Determine redirect target (default to production app if not inferred)
        const frontendUrl = (req.headers.referer || "https://app.colabwize.com").split("/dashboard")[0];
        
        return res.redirect(`${frontendUrl}/dashboard/settings/account?mendeley_success=true`);

    } catch (error: any) {
        const errorData = error.response?.data;
        const statusCode = error.response?.status || 500;
        
        console.error("[Mendeley Callback] Token Exchange Failed:", {
            status: statusCode,
            message: error.message,
            data: errorData
        });
        
        const errorMessage = errorData?.error_description || errorData?.message || error.message;
        return res.status(statusCode).send(`Mendeley Token Exchange Failed: ${errorMessage}`);
    }
});

export default router;
