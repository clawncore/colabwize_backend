import { google, Auth } from "googleapis";
import { prisma } from "../lib/prisma";
import { Readable } from "stream";

/**
 * Service for interacting with Google Drive API
 */
export class GoogleDriveService {
  /** Per-user locks to prevent concurrent OAuth refreshes from invalidating tokens */
  private static refreshLocks = new Map<string, Promise<Auth.OAuth2Client>>();

  /**
   * Get authorized client for a user, serialising refresh calls per-user
   * so that concurrent requests share a single token refresh instead of
   * racing and invalidating refresh tokens.
   */
  private static async getAuthorizedClient(userId: string): Promise<Auth.OAuth2Client> {
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
   * Internal implementation that reads tokens, refreshes, and
   * builds the client. Called inside the per-user lock.
   */
  private static async _refreshAndBuildClient(userId: string): Promise<Auth.OAuth2Client> {
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

    const accessToken = user.google_access_token || undefined;

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: user.google_refresh_token,
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
          google_access_token: credentials.access_token || undefined,
          google_token_expires_at: credentials.expiry_date
            ? new Date(credentials.expiry_date)
            : null,
        },
      });
    }

    return oauth2Client;
  }

  private static createOAuth2Client(): Auth.OAuth2Client {
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
    const REDIRECT_URI = `${BACKEND_URL}/api/auth/google/callback`;

    return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  }

  /**
   * List Document files from Google Drive
   */
  static async listFiles(userId: string, folderId: string = "root") {
    const auth = await this.getAuthorizedClient(userId);

    console.log(
      `[GoogleDriveService] listFiles executing for user ${userId}. Folder: ${folderId}`,
    );

    const drive = google.drive({ version: "v3", auth });

    try {
      const response = await drive.files.list({
        q: "mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
        fields:
          "files(id, name, mimeType, modifiedTime, size, iconLink, webViewLink)",
        spaces: "drive",
      });
      return response.data.files || [];
    } catch (e: any) {
      console.error("[GoogleDriveService] API Call Failed: ", e.message);
      throw e;
    }
  }

  /**
   * Download a file from Google Drive
   */
  static async getFileContent(userId: string, fileId: string) {
    const auth = await this.getAuthorizedClient(userId);
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
        {
          fileId,
          mimeType: docxMimeType,
        },
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
      {
        fileId,
        alt: "media",
      },
      { responseType: "stream" },
    );

    return {
      stream: response.data,
      fileName: file.data.name,
      mimeType: file.data.mimeType,
    };
  }

  /**
   * Upload a file to Google Drive
   */
  static async uploadFile(
    userId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ) {
    const auth = await this.getAuthorizedClient(userId);
    const drive = google.drive({ version: "v3", auth });

    // Convert Buffer to Readable Stream
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: mimeType,
      },
      media: {
        mimeType: mimeType,
        body: stream,
      },
      fields: "id, name, webViewLink",
    });

    return response.data;
  }
}
