import { Readable } from "stream";
import { OneDriveService } from "../onedriveService";
import { IStorageProvider, ProviderFile, ProviderUploadResult } from "./IStorageProvider";

/**
 * OneDrive adapter implementing the IStorageProvider interface.
 */
export class OneDriveProvider implements IStorageProvider {
  readonly name = "onedrive";

  async listFiles(userId: string, folderId?: string): Promise<ProviderFile[]> {
    const result = await OneDriveService.listFiles(userId, folderId);
    return result.files.map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size,
      modifiedTime: f.lastModifiedDateTime,
      webUrl: f.webUrl,
      downloadUrl: f.downloadUrl,
    }));
  }

  async downloadFile(
    userId: string,
    fileId: string,
  ): Promise<{ stream: Readable; fileName: string; mimeType: string }> {
    return OneDriveService.getFileContent(userId, fileId);
  }

  async uploadFile(
    userId: string,
    fileName: string,
    stream: Readable,
    mimeType: string,
  ): Promise<ProviderUploadResult> {
    const result = await OneDriveService.uploadFile(userId, fileName, stream, mimeType);
    return {
      id: result.id,
      name: result.name,
      path: result.id,
      webUrl: result.webUrl,
    };
  }

  async deleteFile(userId: string, fileId: string): Promise<void> {
    const accessToken = await (OneDriveService as any).getAccessToken(userId);
    const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`OneDrive delete failed: ${res.status}`);
    }
  }
}
