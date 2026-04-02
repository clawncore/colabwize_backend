import { google } from "googleapis";
import { prisma } from "../lib/prisma";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
const REDIRECT_URI = `${BACKEND_URL}/api/auth/google/callback`;

/**
 * Service for interacting with Google Drive API
 */
export class GoogleDriveService {
  private static createOAuth2Client() {
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
    const REDIRECT_URI = `${BACKEND_URL}/api/auth/google/callback`;

    return new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI
    );
  }

  /**
   * Get authorized client for a user
   */
  private static async getAuthorizedClient(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        google_access_token: true,
        google_refresh_token: true,
        google_token_expires_at: true,
      },
    });

    if (!user?.google_access_token) {
      throw new Error("Google Drive not connected");
    }

    const oauth2Client = this.createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: user.google_access_token,
      refresh_token: user.google_refresh_token,
      expiry_date: user.google_token_expires_at?.getTime(),
    });

    // Check if token needs refresh
    const isExpired = user.google_token_expires_at && user.google_token_expires_at.getTime() < Date.now();
    if (isExpired && user.google_refresh_token) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      await prisma.user.update({
        where: { id: userId },
        data: {
          google_access_token: credentials.access_token,
          google_token_expires_at: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
        },
      });
    }

    return oauth2Client;
  }

  /**
   * List PDF/Document files from Google Drive
   */
  static async listFiles(userId: string, folderId: string = 'root') {
    const auth = await this.getAuthorizedClient(userId);
    const drive = google.drive({ version: 'v3', auth });

    const response = await drive.files.list({
      q: "mimeType = 'application/pdf' or mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
      fields: 'files(id, name, mimeType, modifiedTime, size, iconLink, webViewLink)',
      spaces: 'drive',
    });

    return response.data.files || [];
  }

  /**
   * Download a file from Google Drive
   */
  static async getFileContent(userId: string, fileId: string) {
    const auth = await this.getAuthorizedClient(userId);
    const drive = google.drive({ version: 'v3', auth });

    const file = await drive.files.get({
      fileId,
      fields: 'name, mimeType',
    });

    if (!file.data.mimeType) throw new Error("Could not determine file type");

    // Handle Google Docs (export to PDF)
    if (file.data.mimeType === 'application/vnd.google-apps.document') {
      const response = await drive.files.export({
        fileId,
        mimeType: 'application/pdf',
      }, { responseType: 'stream' });
      return { stream: response.data, fileName: `${file.data.name}.pdf`, mimeType: 'application/pdf' };
    }

    // Handle regular files (download)
    const response = await drive.files.get({
      fileId,
      alt: 'media',
    }, { responseType: 'stream' });

    return { stream: response.data, fileName: file.data.name, mimeType: file.data.mimeType };
  }
}
