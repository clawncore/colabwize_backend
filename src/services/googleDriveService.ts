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
   */
  static async listFiles(userId: string, folderId: string = "root") {
    const auth = await this.getAuthorizedClient(userId);

    // Diagnostic: log whether we have credentials
    const creds = auth.credentials;
    console.log(`[GoogleDriveService] Calling listFiles for user ${userId}, folderId=${folderId}`);
    console.log(`[GoogleDriveService] Credentials present: access_token=${!!creds.access_token}, refresh_token=${!!creds.refresh_token}, expiry=${creds.expiry_date ? new Date(creds.expiry_date).toISOString() : 'none'}`);
    console.log(`[GoogleDriveService] GOOGLE_CLIENT_ID=${process.env.GOOGLE_CLIENT_ID?.substring(0, 20)}..., BACKEND_URL=${process.env.BACKEND_URL}`);

    await this.ensureFreshToken(auth);

    const drive = google.drive({ version: "v3", auth });

    try {
      const response = await drive.files.list({
        q: "mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
        fields: "files(id, name, mimeType, modifiedTime, size, iconLink, webViewLink)",
        spaces: "drive",
      });
      return response.data.files || [];
    } catch (e: any) {
      console.error("[GoogleDriveService] API Call Failed:", e.message);
      console.error("[GoogleDriveService] Error details:", JSON.stringify(e.response?.data || e, null, 2));
      // Preserve the original error code/status for upstream handling
      const status = e.response?.status || e.code || e.status;
      if (status) {
        (e as any).code = status;
        (e as any).status = status;
      }
      // Provide a clearer error message
      if (status === 401) {
        throw new Error("Google Drive authentication failed. Please reconnect your account in Settings.");
      }
      if (status === 403) {
        const errorMsg = e?.response?.data?.error?.message || e.message || "";
        if (errorMsg.includes("rate limit") || errorMsg.includes("quota")) {
          throw new Error("Google Drive rate limit exceeded. Please wait a moment and try again.");
        }
        // Check for the specific "unregistered callers" error
        if (errorMsg.includes("unregistered callers") || errorMsg.includes("without established identity")) {
          throw new Error("Google Drive API is rejecting requests because the Google Cloud project is not properly configured. Please check: (1) Billing must be enabled on the Google Cloud console → APIs & Services → Billing, (2) The Drive API must be enabled in the SAME project as the OAuth client, (3) Go to console.cloud.google.com → APIs & Services → Enabled APIs and verify 'Google Drive API' is listed. After fixing, reconnect your account in Settings.");
        }
        throw new Error("Google Drive access denied. This may be because: (1) Your OAuth consent screen is in Testing mode — publish it in Google Cloud Console, (2) The Drive API is not enabled, or (3) Your token has been revoked. Try reconnecting your account in Settings.");
      }
      if (status === 429) {
        throw new Error("Google Drive rate limit exceeded. Please wait a moment and try again.");
      }
      throw e;
    }
  }

  /**
   * Download a file from Google Drive. Returns a readable stream.
   */
  static async getFileContent(userId: string, fileId: string) {
    const auth = await this.getAuthorizedClient(userId);
    await this.ensureFreshToken(auth);
    const drive = google.drive({ version: "v3", auth });

    const file = await drive.files.get({
      fileId,
      fields: "name, mimeType",
    });

    if (!file.data.mimeType) throw new Error("Could not determine file type");

    // Handle Google Docs (export to DOCX)
    if (file.data.mimeType === "application/vnd.google-apps.document") {
      const docxMimeType =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const response = await drive.files.export(
        { fileId, mimeType: docxMimeType },
        { responseType: "stream" },
      );
      return {
        stream: response.data,
        fileName: `${file.data.name}.docx`,
        mimeType: docxMimeType,
      };
    }

    // Handle regular files (download)
    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" },
    );

    return {
      stream: response.data,
      fileName: file.data.name,
      mimeType: file.data.mimeType,
    };
  }

  /**
   * Upload a file to Google Drive from a Buffer.
   */
  static async uploadFile(
    userId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ) {
    const auth = await this.getAuthorizedClient(userId);
    await this.ensureFreshToken(auth);
    const drive = google.drive({ version: "v3", auth });

    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    const response = await drive.files.create({
      requestBody: { name: fileName, mimeType },
      media: { mimeType, body: stream },
      fields: "id, name, webViewLink",
    });

    return response.data;
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
    const auth = await this.getAuthorizedClient(userId);
    await this.ensureFreshToken(auth);
    const drive = google.drive({ version: "v3", auth });

    const response = await drive.files.create({
      requestBody: { name: fileName, mimeType },
      media: { mimeType, body: stream },
      fields: "id, name, webViewLink",
    });

    return response.data;
  }
}
