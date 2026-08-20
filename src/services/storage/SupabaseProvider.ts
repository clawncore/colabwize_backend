import { Readable } from "stream";
import { SupabaseStorageService } from "../supabaseStorageService";
import { IStorageProvider, ProviderFile, ProviderUploadResult } from "./IStorageProvider";
import { prisma } from "../../lib/prisma";

/**
 * Supabase Storage adapter implementing the IStorageProvider interface.
 * This is the primary storage backend — files from Google Drive and OneDrive
 * are imported into Supabase Storage via this provider.
 */
export class SupabaseProvider implements IStorageProvider {
  readonly name = "supabase";

  async listFiles(userId: string, folderId?: string): Promise<ProviderFile[]> {
    const files = await prisma.file.findMany({
      where: { user_id: userId, ...(folderId ? { project_id: folderId } : {}) },
      orderBy: { uploaded_at: "desc" },
    });
    return files.map((f: any) => ({
      id: f.id,
      name: f.file_name,
      mimeType: f.file_type,
      size: f.file_size,
      modifiedTime: f.uploaded_at?.toISOString(),
      webUrl: (f.metadata as any)?.publicUrl,
      downloadUrl: null,
    }));
  }

  async downloadFile(
    userId: string,
    fileId: string,
  ): Promise<{ stream: Readable; fileName: string; mimeType: string }> {
    const file = await prisma.file.findFirst({
      where: { id: fileId, user_id: userId },
    });
    if (!file) throw new Error("File not found");

    const buffer = await SupabaseStorageService.downloadFile(file.file_path);
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    return {
      stream,
      fileName: file.file_name,
      mimeType: file.file_type,
    };
  }

  async uploadFile(
    userId: string,
    fileName: string,
    stream: Readable,
    mimeType: string,
  ): Promise<ProviderUploadResult> {
    const result = await SupabaseStorageService.uploadFileStream(
      stream,
      fileName,
      mimeType,
      userId,
    );
    return {
      id: result.path,
      name: fileName,
      path: result.path,
      publicUrl: result.publicUrl,
    };
  }

  async deleteFile(userId: string, fileId: string): Promise<void> {
    const file = await prisma.file.findFirst({
      where: { id: fileId, user_id: userId },
    });
    if (!file) throw new Error("File not found");

    await SupabaseStorageService.deleteFile(file.file_path);
  }
}
