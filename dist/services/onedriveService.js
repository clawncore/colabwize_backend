"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OneDriveService = void 0;
const prisma_1 = require("../lib/prisma");
const stream_1 = require("stream");
const tokenCrypto_1 = require("./crypto/tokenCrypto");
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
/**
 * Service for interacting with Microsoft OneDrive via Microsoft Graph API.
 *
 * Token handling mirrors GoogleDriveService:
 * - Tokens stored AES-256-GCM encrypted on User model.
 * - decryptOrPlaintext() handles migration from plaintext.
 * - Per-user in-memory lock prevents concurrent refresh races.
 *
 * API reference: https://learn.microsoft.com/en-us/graph/api/resources/onedrive
 */
class OneDriveService {
    /** Per-user locks to prevent concurrent OAuth refreshes */
    static refreshLocks = new Map();
    /** Per-user cooldown to prevent rapid retry loops after failed refresh */
    static refreshCooldowns = new Map();
    static REFRESH_COOLDOWN_MS = 60_000; // 1 minute
    /**
     * Get a valid access token for the user, refreshing if necessary.
     * Serialises refresh calls per-user.
     */
    static async getAccessToken(userId) {
        const existing = this.refreshLocks.get(userId);
        if (existing)
            return existing;
        const lock = (async () => {
            try {
                return await this._refreshAndReturnToken(userId);
            }
            finally {
                this.refreshLocks.delete(userId);
            }
        })();
        this.refreshLocks.set(userId, lock);
        return lock;
    }
    static async _refreshAndReturnToken(userId) {
        // Check cooldown from recent failed refresh
        const cooldownEnd = this.refreshCooldowns.get(userId);
        if (cooldownEnd && cooldownEnd > Date.now()) {
            throw new Error("OneDrive token refresh failed recently. Please reconnect your account in Settings.");
        }
        this.refreshCooldowns.delete(userId);
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: userId },
            select: {
                onedrive_access_token: true,
                onedrive_refresh_token: true,
                onedrive_token_expires_at: true,
            },
        });
        if (!user?.onedrive_refresh_token) {
            throw new Error("OneDrive not connected");
        }
        const refreshToken = tokenCrypto_1.TokenCrypto.decryptOrPlaintext(user.onedrive_refresh_token);
        const isExpired = user.onedrive_token_expires_at &&
            user.onedrive_token_expires_at.getTime() < Date.now();
        if (!isExpired && user.onedrive_access_token) {
            return tokenCrypto_1.TokenCrypto.decryptOrPlaintext(user.onedrive_access_token);
        }
        console.log(`[OneDriveService] Token expired for ${userId}, refreshing...`);
        const tokenEndpoint = `https://login.microsoftonline.com/common/oauth2/v2.0/token`;
        const body = new URLSearchParams({
            client_id: process.env.MICROSOFT_CLIENT_ID || "",
            client_secret: process.env.MICROSOFT_CLIENT_SECRET || "",
            refresh_token: refreshToken,
            grant_type: "refresh_token",
            scope: "openid email profile Files.ReadWrite.All offline_access",
        });
        const res = await fetch(tokenEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
            // Set cooldown to prevent rapid retries
            this.refreshCooldowns.set(userId, Date.now() + this.REFRESH_COOLDOWN_MS);
            throw new Error(`OneDrive token refresh failed: ${data.error_description || data.error}`);
        }
        // Always update refresh_token when Microsoft returns a new one.
        // Microsoft rotates refresh tokens periodically — if we don't store the new one,
        // the old token becomes invalid and the user must reconnect.
        const updateData = {
            onedrive_access_token: tokenCrypto_1.TokenCrypto.encrypt(data.access_token),
            onedrive_token_expires_at: data.expires_in
                ? new Date(Date.now() + data.expires_in * 1000)
                : null,
        };
        if (data.refresh_token) {
            updateData.onedrive_refresh_token = tokenCrypto_1.TokenCrypto.encrypt(data.refresh_token);
        }
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: updateData,
        });
        return data.access_token;
    }
    /**
     * Make an authenticated request to the Microsoft Graph API.
     */
    static async graphRequest(accessToken, path, options = {}) {
        const res = await fetch(`${GRAPH_BASE}${path}`, {
            ...options,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                ...(options.headers || {}),
            },
        });
        if (!res.ok) {
            const errorBody = await res.text();
            // Try to extract a meaningful error from Graph API error responses
            let errorMessage = errorBody;
            try {
                const parsed = JSON.parse(errorBody);
                errorMessage = parsed.error?.message || parsed.error?.code || errorBody;
            }
            catch {
                // Not JSON — use the raw text (could be HTML error page)
                // Truncate long HTML responses
                errorMessage = errorBody.length > 200 ? errorBody.substring(0, 200) + "..." : errorBody;
            }
            // Translate known technical errors into user-friendly messages
            if (res.status === 404) {
                if (errorMessage.includes("Item does not exist") || errorMessage.includes("itemNotFound")) {
                    throw new Error("The requested OneDrive folder or file was not found. It may have been moved or deleted.");
                }
                throw new Error("OneDrive resource not found. Please check the file and try again.");
            }
            if (res.status === 403 || errorMessage.includes("accessDenied")) {
                throw new Error("OneDrive access denied. Please check your permissions or reconnect your account.");
            }
            throw new Error(`OneDrive error (${res.status}): ${errorMessage}`);
        }
        // 204 No Content or empty body — return empty object
        if (res.status === 204 || res.headers.get("content-length") === "0") {
            return {};
        }
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            const text = await res.text();
            if (!text)
                return {};
            return JSON.parse(text);
        }
        // Non-JSON response (e.g., file download) — return the response object
        return res;
    }
    /**
     * List files from the user's OneDrive root.
     * Returns document files (Word, PDF, text) with pagination support.
     */
    static async listFiles(userId, folderId, skipToken, pageSize = 100) {
        const accessToken = await this.getAccessToken(userId);
        const path = folderId
            ? `/me/drive/items/${folderId}/children`
            : `/me/drive/root/children`;
        const limit = Math.min(Math.max(pageSize, 1), 1000);
        let url = `${path}?$top=${limit}`;
        if (skipToken) {
            url += `&$skiptoken=${encodeURIComponent(skipToken)}`;
        }
        const data = await this.graphRequest(accessToken, url);
        // Filter to document types we can import
        const documentMimeTypes = new Set([
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/pdf",
            "text/plain",
            "application/msword",
            "application/rtf",
        ]);
        // Parse @odata.nextLink to extract just the $skiptoken parameter
        // Microsoft returns a full URL like "https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=abc123"
        let nextPageToken = null;
        const nextLink = data["@odata.nextLink"];
        if (nextLink) {
            try {
                const url = new URL(nextLink);
                nextPageToken = url.searchParams.get("$skiptoken") || nextLink;
            }
            catch {
                nextPageToken = nextLink;
            }
        }
        return {
            files: (data.value || [])
                .filter((item) => !item.folder && documentMimeTypes.has(item.file?.mimeType || ""))
                .map((item) => ({
                id: item.id,
                name: item.name,
                mimeType: item.file?.mimeType,
                size: item.size,
                lastModifiedDateTime: item.lastModifiedDateTime,
                webUrl: item.webUrl,
                downloadUrl: item["@microsoft.graph.downloadUrl"] || null,
            })),
            nextPageToken,
        };
    }
    /** Max file download size: 100MB by default */
    static maxDownloadSize = parseInt(process.env.ONEDRIVE_MAX_DOWNLOAD_SIZE_MB || "100", 10) * 1024 * 1024;
    /**
     * Download a file from OneDrive. Returns a readable stream.
     * Validates file size before streaming.
     */
    static async getFileContent(userId, fileId) {
        const accessToken = await this.getAccessToken(userId);
        // Get file metadata first (includes size)
        const meta = await this.graphRequest(accessToken, `/me/drive/items/${fileId}`);
        // Validate file size
        if (meta.size && meta.size > this.maxDownloadSize) {
            const sizeMB = (meta.size / (1024 * 1024)).toFixed(1);
            const limitMB = this.maxDownloadSize / (1024 * 1024);
            throw new Error(`File too large (${sizeMB}MB). Maximum allowed: ${limitMB}MB.`);
        }
        const downloadUrl = meta["@microsoft.graph.downloadUrl"];
        if (!downloadUrl) {
            throw new Error("No download URL available for this file");
        }
        // Download using the direct download URL (no auth needed for this URL)
        const res = await fetch(downloadUrl);
        if (!res.ok) {
            throw new Error(`OneDrive download failed: ${res.status}`);
        }
        return {
            stream: stream_1.Readable.fromWeb(res.body),
            fileName: meta.name,
            mimeType: meta.file?.mimeType || "application/octet-stream",
        };
    }
    /**
     * Upload a file to OneDrive.
     * For files < 4MB uses simple PUT. For larger files uses upload session.
     */
    static async uploadFile(userId, fileName, stream, mimeType) {
        const accessToken = await this.getAccessToken(userId);
        // Read stream into buffer for size check
        const chunks = [];
        await new Promise((resolve, reject) => {
            stream.on("data", (chunk) => chunks.push(chunk));
            stream.on("error", reject);
            stream.on("end", () => resolve());
        });
        const buffer = Buffer.concat(chunks);
        const FOUR_MB = 4 * 1024 * 1024;
        if (buffer.length < FOUR_MB) {
            // Simple upload for small files
            const res = await fetch(`${GRAPH_BASE}/me/drive/root:/${encodeURIComponent(fileName)}:/content`, {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": mimeType,
                },
                body: buffer,
            });
            if (!res.ok) {
                const err = await res.text();
                throw new Error(`OneDrive upload failed: ${res.status} ${err}`);
            }
            return await res.json();
        }
        // Large file upload via session
        const sessionRes = await fetch(`${GRAPH_BASE}/me/drive/root:/${encodeURIComponent(fileName)}:/createUploadSession`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                item: {
                    "@microsoft.graph.conflictBehavior": "rename",
                    name: fileName,
                },
            }),
        });
        if (!sessionRes.ok) {
            const err = await sessionRes.text();
            throw new Error(`OneDrive upload session failed: ${sessionRes.status} ${err}`);
        }
        const session = await sessionRes.json();
        const uploadUrl = session.uploadUrl;
        // Upload in chunks
        const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
        let offset = 0;
        while (offset < buffer.length) {
            const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
            const end = offset + chunk.length - 1;
            const total = buffer.length;
            const chunkRes = await fetch(uploadUrl, {
                method: "PUT",
                headers: {
                    "Content-Length": chunk.length.toString(),
                    "Content-Range": `bytes ${offset}-${end}/${total}`,
                },
                body: chunk,
            });
            if (!chunkRes.ok && chunkRes.status !== 202) {
                const err = await chunkRes.text();
                throw new Error(`OneDrive chunk upload failed: ${chunkRes.status} ${err}`);
            }
            offset += chunk.length;
        }
        // Final response contains the file metadata
        return { id: fileName, name: fileName };
    }
}
exports.OneDriveService = OneDriveService;
