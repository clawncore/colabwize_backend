import { Readable } from "stream";
import { GoogleDriveService } from "../googleDriveService";
import { IStorageProvider, ProviderFile, ProviderUploadResult } from "./IStorageProvider";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/**
 * Google Drive adapter implementing the IStorageProvider interface.
 */
export class GoogleDriveProvider implements IStorageProvider {
  readonly name = "google-drive";

  async listFiles(userId: string, folderId?: string): Promise<ProviderFile[]> {
    const result = await GoogleDriveService.listFiles(userId, folderId || "root");
    return result.files.map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size ? parseInt(f.size, 10) : undefined,
      modifiedTime: f.modifiedTime,
      webUrl: f.webViewLink,
      downloadUrl: null,
    }));
  }

  async downloadFile(
    userId: string,
    fileId: string,
  ): Promise<{ stream: Readable; fileName: string; mimeType: string }> {
    const result = await GoogleDriveService.getFileContent(userId, fileId);
    return {
      stream: result.stream,
      fileName: result.fileName ?? "untitled",
      mimeType: result.mimeType,
    };
  }

  async uploadFile(
    userId: string,
    fileName: string,
    stream: Readable,
    mimeType: string,
  ): Promise<ProviderUploadResult> {
    const result = await GoogleDriveService.uploadFileStream(userId, fileName, stream, mimeType);
    return {
      id: result.id ?? "",
      name: result.name ?? fileName,
      path: result.id ?? "",
      webUrl: result.webViewLink ?? undefined,
    };
  }

  async deleteFile(userId: string, fileId: string): Promise<void> {
    const auth = await (GoogleDriveService as AnyClient).getAuthorizedClient(userId);
    const { google } = await import("googleapis");
    const drive = google.drive({ version: "v3", auth });
    await drive.files.delete({ fileId });
  }
}
