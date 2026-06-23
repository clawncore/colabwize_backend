import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "../lib/prisma";
import { Readable } from "stream";
import { TokenCrypto } from "./crypto/tokenCrypto";

/**
 * Service for interacting with Google Drive API.
 *
 * Token handling:
 * - Tokens are stored AES-256-GCM encrypted on the User model.
 * - decryptOrPlaintext() handles the migration period where some tokens
 *   may still be plaintext from before the encryption migration.
 *
 * Concurrency:
 * - getAuthorizedClient() uses a per-user in-memory lock so that concurrent
 *   requests with expired tokens share a single refresh call instead of racing.
 */
export class GoogleDriveService {
  /** Per-user locks to prevent concurrent OAuth refreshes from invalidating tokens */
  private static refreshLocks = new Map<string, Promise<OAuth2Client>>();

  /**
   * Get an authorized OAuth2 client for the given user.
   * Serialises refresh calls per-user via an in-memory mutex.
   */
  private static async getAuthorizedClient(userId: string): Promise<OAuth2Client> {
    const existing = this.refreshLocks.get(userId);
    if (existing) return existing;

    const lock = (async () => {
      try {
        return await this._refreshAndBuildClient(userId);
      } finally {
        this.refreshLocks.delete(userId);
      }
    })();

    this.refreshLocks.set(userId, lock);
    return lock;
  }

  /**
   * Internal implementation: reads tokens (decrypting if needed), refreshes
   * if expired, encrypts updated tokens, and builds the OAuth2 client.
   */
  private static async _refreshAndBuildClient(userId: string): Promise<OAuth2Client> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        google_access_token: true,
        google_refresh_token: true,
        google_token_expires_at: true,
      },
    });

    if (!user?.google_refresh_token) {
      throw new Error("Google Drive not connected");
    }

    const oauth2Client = this.createOAuth2Client();

    // DecryptOrPlaintext handles migration: encrypted tokens are decrypted,
    // plaintext tokens (pre-migration) are returned as-is.
    const accessToken = user.google_access_token
      ? TokenCrypto.decryptOrPlaintext(user.google_access_token)
      : undefined;
    const refreshToken = TokenCrypto.decryptOrPlaintext(user.google_refresh_token);

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: user.google_token_expires_at?.getTime(),
    });

    const isExpired =
      user.google_token_expires_at &&
      user.google_token_expires_at.getTime() < Date.now();

    if (isExpired) {
      console.log(`[GoogleDriveService] Token expired for ${userId}, refreshing...`);
      const { credentials } = await oauth2Client.refreshAccessToken();
      await prisma.user.update({
        where: { id: userId },
        data: {
          google_access_token: credentials.access_token
            ? TokenCrypto.encrypt(credentials.access_token)
            : null,
          google_token_expires_at: credentials.expiry_date
            ? new Date(credentials.expiry_date)
            : null,
        },
      });
    }

    return oauth2Client;
  }

  /**
   * Proactively refresh the token if it expires within the next 5 minutes.
   * The mutex in getAuthorizedClient already handles the expired case, but
   * this catches the "about to expire" window so the actual API call
   * doesn't fail mid-request.
   */
  private static async ensureFreshToken(auth: OAuth2Client): Promise<void> {
    const expiresIn = auth.credentials.expiry_date
      ? auth.credentials.expiry_date - Date.now()
      : 0;
    if (expiresIn < 5 * 60 * 1000) {
      try {
        await auth.refreshAccessToken();
      } catch {
        // Ignore — the API call will fail with a clear error if the token is bad
      }
    }
  }

  private static createOAuth2Client(): OAuth2Client {
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
    const REDIRECT_URI = `${BACKEND_URL}/api/auth/google/callback`;

    return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  }

  /**
   * List document files from Google Drive.
   * Supports pagination via pageToken and configurable pageSize.
   */
  static async listFiles(
    userId: string,
    folderId: string = "root",
    pageToken?: string,
    pageSize: number = 100,
  ) {
    const accessToken = await this.getAccessToken(userId);

    // Clamp pageSize to Google's max of 1000, default 100
    const limit = Math.min(Math.max(pageSize, 1), 1000);

    // List document & PDF files only (no images, videos, etc.)
    const query = encodeURIComponent(
      "trashed = false and (" +
      "mimeType = 'application/vnd.google-apps.document' or " +
      "mimeType = 'application/vnd.google-apps.spreadsheet' or " +
      "mimeType = 'application/vnd.google-apps.presentation' or " +
      "mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or " +
      "mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or " +
      "mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation' or " +
      "mimeType = 'application/pdf' or " +
      "mimeType = 'application/msword' or " +
      "mimeType = 'application/rtf' or " +
      "mimeType = 'text/plain' or " +
      "mimeType = 'text/csv' or " +
      "mimeType contains 'word' or " +
      "mimeType contains 'pdf' or " +
      "mimeType contains 'text'" +
      ")"
    );

    let url = `https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=${limit}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size,iconLink,webViewLink,parents)&orderBy=name`;
    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Cache-Control": "no-cache",
        },
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        const errorMsg = errorBody?.error?.message || `HTTP ${res.status}`;

        if (res.status === 401) {
          throw new Error("Google Drive authentication failed. Please reconnect your account in Settings.");
        }
        if (res.status === 403) {
          if (errorMsg.includes("rate limit") || errorMsg.includes("quota")) {
            throw new Error("Google Drive rate limit exceeded. Please wait a moment and try again.");
          }
          if (errorMsg.includes("unregistered callers") || errorMsg.includes("without established identity")) {
            throw new Error("Google Drive is temporarily unavailable. Please contact support if this persists.");
          }
          throw new Error("Google Drive access denied. Please check your permissions or reconnect your account in Settings.");
        }
        if (res.status === 429) {
          throw new Error("Google Drive rate limit exceeded. Please wait a moment and try again.");
        }
        throw new Error(`Google Drive API error: ${errorMsg}`);
      }

      const data = await res.json();
      return {
        files: data.files || [],
        nextPageToken: data.nextPageToken || null,
      };
    } catch (e: any) {
      if (e.message?.includes("Google Drive")) throw e; // already wrapped
      throw new Error("Google Drive request failed. Please try again.");
    }
  }

  /**
   * Get a valid access token for the user, refreshing if necessary.
   * Returns the raw access token string (not the OAuth2Client).
   */
  private static async getAccessToken(userId: string): Promise<string> {
    const auth = await this.getAuthorizedClient(userId);
    await this.ensureFreshToken(auth);
    return auth.credentials.access_token as string;
  }

  /** Max file download size: 100MB by default */
  static maxDownloadSize = parseInt(process.env.GOOGLE_DRIVE_MAX_DOWNLOAD_SIZE_MB || "100", 10) * 1024 * 1024;

  /**
   * Download a file from Google Drive. Returns a readable stream.
   * Uses raw fetch with Bearer token (same pattern as OneDrive).
   * Validates file size before streaming.
   */
  static async getFileContent(userId: string, fileId: string) {
    const accessToken = await this.getAccessToken(userId);

    // Get file metadata first (includes size)
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields,name,mimeType,size`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!metaRes.ok) {
      const err = await metaRes.json().catch(() => ({}));
      throw new Error(`Google Drive file not found: ${err?.error?.message || metaRes.status}`);
    }

    const file = await metaRes.json();

    if (!file.mimeType) throw new Error("Could not determine file type");

    // Validate file size
    if (file.size && parseInt(file.size, 10) > this.maxDownloadSize) {
      const sizeMB = (parseInt(file.size, 10) / (1024 * 1024)).toFixed(1);
      const limitMB = this.maxDownloadSize / (1024 * 1024);
      throw new Error(`File too large (${sizeMB}MB). Maximum allowed: ${limitMB}MB.`);
    }

    // Handle Google Docs (export to DOCX)
    if (file.mimeType === "application/vnd.google-apps.document") {
      const docxMimeType =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const exportRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(docxMimeType)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!exportRes.ok) {
        throw new Error(`Google Docs export failed: ${exportRes.status}`);
      }
      return {
        stream: Readable.fromWeb(exportRes.body as any),
        fileName: `${file.name}.docx`,
        mimeType: docxMimeType,
      };
    }

    // Handle regular files (download)
    const downloadRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!downloadRes.ok) {
      throw new Error(`Google Drive download failed: ${downloadRes.status}`);
    }

    return {
      stream: Readable.fromWeb(downloadRes.body as any),
      fileName: file.name,
      mimeType: file.mimeType,
    };
  }

  /**
   * Upload a file to Google Drive from a Buffer.
   * Uses raw fetch with multipart upload (same pattern as OneDrive).
   */
  static async uploadFile(
    userId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ) {
    const accessToken = await this.getAccessToken(userId);

    // Use multipart upload for reliability
    const boundary = `----FormBoundary${Date.now()}`;
    const metadata = JSON.stringify({ name: fileName, mimeType });

    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: binary\r\n\r\n`,
      ),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
          "Content-Length": body.length.toString(),
        },
        body: body as any,
      },
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Google Drive upload failed: ${err?.error?.message || res.status}`);
    }

    return res.json();
  }

  /**
   * Upload a file to Google Drive from a Readable stream.
   * Preferred for large files to avoid buffering entire content in memory.
   */
  static async uploadFileStream(
    userId: string,
    fileName: string,
    stream: Readable,
    mimeType: string,
  ) {
    // Buffer the stream first, then use multipart upload
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve());
    });
    const buffer = Buffer.concat(chunks);
    return this.uploadFile(userId, fileName, buffer, mimeType);
  }
}
