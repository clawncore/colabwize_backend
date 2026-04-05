import axios from "axios";
import { prisma } from "../lib/prisma.js";

const MENDELEY_CLIENT_ID = (process.env.MENDELEY_CLIENT_ID || "").trim();
const MENDELEY_CLIENT_SECRET = (process.env.MENDELEY_CLIENT_SECRET || "").trim();
const MENDELEY_API_KEY = (process.env.MENDELEY_API_KEY || MENDELEY_CLIENT_SECRET).trim();
const TOKEN_URL = "https://api.mendeley.com/oauth/token";

export class MendeleyService {
    /**
     * Get a valid access token for the user. 
     * If the current token is expired, it attempts to refresh it.
     */
    static async getValidToken(userId: string): Promise<string> {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                mendeley_access_token: true,
                mendeley_refresh_token: true,
                mendeley_token_expires_at: true,
            }
        });

        if (!user || !user.mendeley_access_token) {
            throw new Error("Mendeley account not linked");
        }

        const now = new Date();
        const expiresAt = user.mendeley_token_expires_at ? new Date(user.mendeley_token_expires_at) : null;

        // If token is expired (or expires in less than 30 seconds), refresh it
        if (user.mendeley_refresh_token && expiresAt && now.getTime() > (expiresAt.getTime() - 30000)) {
            console.log(`[Mendeley Service] Token expired for user ${userId}, refreshing...`);
            return await this.refreshToken(userId, user.mendeley_refresh_token);
        }

        return user.mendeley_access_token;
    }

    /**
     * Refresh the Mendeley access token using the refresh token
     */
    static async refreshToken(userId: string, refreshToken: string): Promise<string> {
        try {
            console.log(`[Mendeley Service] Requesting new token from Elsevier for user: ${userId}`);
            
            const params = new URLSearchParams();
            params.append("grant_type", "refresh_token");
            params.append("refresh_token", refreshToken);
            params.append("client_id", MENDELEY_CLIENT_ID);
            params.append("client_secret", MENDELEY_CLIENT_SECRET);

            const headers: any = {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            };

            // Only add Elsevier API Key if it's explicitly provided and not just fallback to secret
            if (process.env.MENDELEY_API_KEY) {
                headers["X-ELS-APIKey"] = process.env.MENDELEY_API_KEY;
            }

            const response = await axios.post(TOKEN_URL, params.toString(), {
                headers,
                timeout: 10000 // 10s timeout for token exchange
            });

            const { access_token, refresh_token, expires_in } = response.data;

            if (!access_token) {
                throw new Error("Elsevier refresh call returned no access_token");
            }

            const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);

            await prisma.user.update({
                where: { id: userId },
                data: {
                    mendeley_access_token: access_token,
                    mendeley_refresh_token: refresh_token || refreshToken, // reuse if not rotated
                    mendeley_token_expires_at: expiresAt,
                }
            });

            console.log(`[Mendeley Service] Token successfully refreshed for user: ${userId}`);
            return access_token;
        } catch (error: any) {
            console.error("[Mendeley Service] Refresh failed:", error.response?.data || error.message);
            // If refresh fails, we might need to clear the tokens so the user re-authenticates
            if (error.response?.status === 400 || error.response?.status === 401) {
                console.warn(`[Mendeley Service] Refresh token invalid for user ${userId}. Clearing tokens.`);
                await prisma.user.update({
                    where: { id: userId },
                    data: {
                        mendeley_access_token: null,
                        mendeley_refresh_token: null,
                        mendeley_token_expires_at: null,
                    }
                });
            }
            throw new Error(`Mendeley session expired. Please reconnect your account. (${error.message})`);
        }
    }

    static async fetchLibrary(userId: string, limit: number = 50, start: number = 0) {
        try {
            const accessToken = await this.getValidToken(userId);
            
            const headers: any = {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json", // Use standard JSON
            };

            if (process.env.MENDELEY_API_KEY) {
                headers["X-ELS-APIKey"] = process.env.MENDELEY_API_KEY;
            }

            const response = await axios.get("https://api.mendeley.com/documents", {
                headers,
                params: {
                    limit,
                    view: "all"
                },
                timeout: 15000 // 15s timeout
            });
            return response.data || [];
        } catch (error: any) {
            console.error("[Mendeley Service] fetchLibrary Error:", error.response?.data || error.message);
            throw error;
        }
    }

    static async queryItems(userId: string, query: string) {
        try {
            const accessToken = await this.getValidToken(userId);

            const headers: any = {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json"
            };

            if (process.env.MENDELEY_API_KEY) {
                headers["X-ELS-APIKey"] = process.env.MENDELEY_API_KEY;
            }

            const response = await axios.get("https://api.mendeley.com/search/catalog", {
                headers,
                params: {
                    title: query,
                    limit: 50,
                    view: "all"
                },
                timeout: 15000
            });
            return response.data || [];
        } catch (error: any) {
            console.error("[Mendeley Service] queryItems Error:", error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Import a Mendeley item into the project's citation list
     */
    static async importItem(colabUserId: string, projectId: string, itemData: any) {
        try {
            const authors = itemData.authors?.map((a: any) => `${a.last_name}, ${a.first_name}`).join("; ") || "Unknown Author";
            const year = itemData.year || 0;

            const citation = await prisma.citation.create({
                data: {
                    user_id: colabUserId,
                    project_id: projectId,
                    title: itemData.title || "Untitled",
                    author: authors,
                    year: Number(year),
                    type: itemData.type || "article",
                    doi: itemData.identifiers?.doi || null,
                    url: itemData.websites?.[0] || null,
                    journal: itemData.source,
                    publisher: itemData.publisher,
                    abstract: itemData.abstract,
                    source: "Mendeley",
                    vault_verified: true, // Mark as verified since it comes from their vault
                    formatted_citations: itemData // Store raw Mendeley for high-fidelity export later
                }
            });

            return citation;
        } catch (error: any) {
            console.error("[Mendeley Service] Import Error:", error.message);
            throw new Error(`Failed to import Mendeley item: ${error.message}`);
        }
    }

    /**
     * Fetch user's Mendeley folders
     */
    static async fetchFolders(userId: string) {
        try {
            const accessToken = await this.getValidToken(userId);
            const headers: any = {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json"
            };

            if (process.env.MENDELEY_API_KEY) {
                headers["X-ELS-APIKey"] = process.env.MENDELEY_API_KEY;
            }

            const response = await axios.get("https://api.mendeley.com/folders", {
                headers,
                timeout: 15000
            });
            return response.data || [];
        } catch (error: any) {
            console.error("[Mendeley Service] fetchFolders Error:", error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Fetch items from a specific Mendeley folder
     */
    static async fetchFolderItems(userId: string, folderId: string) {
        try {
            const accessToken = await this.getValidToken(userId);
            const headers: any = {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json"
            };

            if (process.env.MENDELEY_API_KEY) {
                headers["X-ELS-APIKey"] = process.env.MENDELEY_API_KEY;
            }

            const response = await axios.get(`https://api.mendeley.com/folders/${folderId}/documents`, {
                headers,
                timeout: 15000
            });
            return response.data || [];
        } catch (error: any) {
            console.error("[Mendeley Service] fetchFolderItems Error:", error.response?.data || error.message);
            throw error;
        }
    }
}
