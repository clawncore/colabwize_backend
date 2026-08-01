"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OneDriveProvider = void 0;
const onedriveService_1 = require("../onedriveService");
/**
 * OneDrive adapter implementing the IStorageProvider interface.
 */
class OneDriveProvider {
    name = "onedrive";
    async listFiles(userId, folderId) {
        const result = await onedriveService_1.OneDriveService.listFiles(userId, folderId);
        return result.files.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            size: f.size,
            modifiedTime: f.lastModifiedDateTime,
            webUrl: f.webUrl,
            downloadUrl: f.downloadUrl,
        }));
    }
    async downloadFile(userId, fileId) {
        return onedriveService_1.OneDriveService.getFileContent(userId, fileId);
    }
    async uploadFile(userId, fileName, stream, mimeType) {
        const result = await onedriveService_1.OneDriveService.uploadFile(userId, fileName, stream, mimeType);
        return {
            id: result.id,
            name: result.name,
            path: result.id,
            webUrl: result.webUrl,
        };
    }
    async deleteFile(userId, fileId) {
        const accessToken = await onedriveService_1.OneDriveService.getAccessToken(userId);
        const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
            throw new Error(`OneDrive delete failed: ${res.status}`);
        }
    }
}
exports.OneDriveProvider = OneDriveProvider;
