import { prisma } from "../lib/prisma";
import { Readable } from "stream";
import { TokenCrypto } from "./crypto/tokenCrypto";

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
export class OneDriveService {
  /** Per-user locks to prevent concurrent OAuth refreshes */
  private static refreshLocks = new Map<string, Promise<string>>();

  /**
   * Get a valid access token for the user, refreshing if necessary.
   * Serialises refresh calls per-user.
   */
  private static async getAccessToken(userId: string): Promise<string> {
    const existing = this.refreshLocks.get(userId);
    if (existing) return existing;

    const lock = (async () => {
      try {
        return await this._refreshAndReturnToken(userId);
      } finally {
        this.refreshLocks.delete(userId);
      }
    })();

    this.refreshLocks.set(userId, lock);
    return lock;
  }

  private static async _refreshAndReturnToken(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({
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

    const refreshToken = TokenCrypto.decryptOrPlaintext(user.onedrive_refresh_token);

    const isExpired =
      user.onedrive_token_expires_at &&
      user.onedrive_token_expires_at.getTime() < Date.now();

    if (!isExpired && user.onedrive_access_token) {
      return TokenCrypto.decryptOrPlaintext(user.onedrive_access_token);
    }

    console.log(`[OneDriveService] Token expired for ${userId}, refreshing...`);

    const tokenEndpoint = `https://login.microsoftonline.com/common/oauth2/v0/token`;
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
      throw new Error(`OneDrive token refresh failed: ${data.error_description || data.error}`);
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        onedrive_access_token: TokenCrypto.encrypt(data.access_token),
        onedrive_refresh_token: data.refresh_token
          ? TokenCrypto.encrypt(data.refresh_token)
          : undefined,
        onedrive_token_expires_at: data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000)
          : null,
      },
    });

    return data.access_token;
  }

  /**
   * Make an authenticated request to the Microsoft Graph API.
   */
  private static async graphRequest(
    accessToken: string,
    path: string,
    options: RequestInit = {},
  ): Promise<any> {
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
      throw new Error(`Graph API error ${res.status}: ${errorBody}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return res;
  }

  /**
   * List files from the user's OneDrive root.
   * Returns document files (Word, PDF, text).
   */
  static async listFiles(userId: string, folderId?: string) {
    const accessToken = await this.getAccessToken(userId);

    const path = folderId
      ? `/me/drive/items/${folderId}/children`
      : `/me/drive/root/children`;

    const data = await this.graphRequest(accessToken, `${path}?$top=100`);

    // Filter to document types we can import
    const documentMimeTypes = new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/pdf",
      "text/plain",
      "application/msword",
      "application/rtf",
    ]);

    return (data.value || [])
      .filter((item: any) => !item.folder && documentMimeTypes.has(item.file?.mimeType || ""))
      .map((item: any) => ({
        id: item.id,
        name: item.name,
        mimeType: item.file?.mimeType,
        size: item.size,
        lastModifiedDateTime: item.lastModifiedDateTime,
        webUrl: item.webUrl,
        downloadUrl: item["@microsoft.graph.downloadUrl"] || null,
      }));
  }

  /**
   * Download a file from OneDrive. Returns a readable stream.
   */
  static async getFileContent(userId: string, fileId: string) {
    const accessToken = await this.getAccessToken(userId);

    // Get file metadata first
    const meta = await this.graphRequest(accessToken, `/me/drive/items/${fileId}`);
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
      stream: Readable.fromWeb(res.body as any),
      fileName: meta.name,
      mimeType: meta.file?.mimeType || "application/octet-stream",
    };
  }

  /**
   * Upload a file to OneDrive.
   * For files < 4MB uses simple PUT. For larger files uses upload session.
   */
  static async uploadFile(
    userId: string,
    fileName: string,
    stream: Readable,
    mimeType: string,
  ) {
    const accessToken = await this.getAccessToken(userId);

    // Read stream into buffer for size check
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve());
    });
    const buffer = Buffer.concat(chunks);
    const FOUR_MB = 4 * 1024 * 1024;

    if (buffer.length < FOUR_MB) {
      // Simple upload for small files
      const res = await fetch(
        `${GRAPH_BASE}/me/drive/root:/${encodeURIComponent(fileName)}:/content`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": mimeType,
          },
          body: buffer as any,
        },
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`OneDrive upload failed: ${res.status} ${err}`);
      }

      return await res.json();
    }

    // Large file upload via session
    const sessionRes = await fetch(
      `${GRAPH_BASE}/me/drive/root:/${encodeURIComponent(fileName)}:/createUploadSession`,
      {
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
      },
    );

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
        body: chunk as any,
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
