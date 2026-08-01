"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleDriveProvider = void 0;
const googleDriveService_1 = require("../googleDriveService");
/**
 * Google Drive adapter implementing the IStorageProvider interface.
 */
class GoogleDriveProvider {
    name = "google-drive";
    async listFiles(userId, folderId) {
        const result = await googleDriveService_1.GoogleDriveService.listFiles(userId, folderId || "root");
        return result.files.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            size: f.size ? parseInt(f.size, 10) : undefined,
            modifiedTime: f.modifiedTime,
            webUrl: f.webViewLink,
            downloadUrl: null,
        }));
    }
    async downloadFile(userId, fileId) {
        const result = await googleDriveService_1.GoogleDriveService.getFileContent(userId, fileId);
        return {
            stream: result.stream,
            fileName: result.fileName ?? "untitled",
            mimeType: result.mimeType,
        };
    }
    async uploadFile(userId, fileName, stream, mimeType) {
        const result = await googleDriveService_1.GoogleDriveService.uploadFileStream(userId, fileName, stream, mimeType);
        return {
            id: result.id ?? "",
            name: result.name ?? fileName,
            path: result.id ?? "",
            webUrl: result.webViewLink ?? undefined,
        };
    }
    async deleteFile(userId, fileId) {
        const auth = await googleDriveService_1.GoogleDriveService.getAuthorizedClient(userId);
        const { google } = await import("googleapis");
        const drive = google.drive({ version: "v3", auth });
        await drive.files.delete({ fileId });
    }
}
exports.GoogleDriveProvider = GoogleDriveProvider;
