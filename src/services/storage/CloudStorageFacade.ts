import { Readable } from "stream";
import { prisma } from "../../lib/prisma";
import { StorageService } from "../../services/storageService";
import { SupabaseStorageService } from "../../services/supabaseStorageService";
import { IStorageProvider, ProviderFile, ProviderUploadResult } from "./IStorageProvider";
import { GoogleDriveProvider } from "./GoogleDriveProvider";
import { OneDriveProvider } from "./OneDriveProvider";
import { SupabaseProvider } from "./SupabaseProvider";
import logger from "../../monitoring/logger";

export type CloudProvider = "google-drive" | "onedrive" | "supabase";

/**
 * CloudStorageFacade provides a unified interface for importing and exporting
 * files across Google Drive, OneDrive, and Supabase Storage.
 *
 * Import flow: Provider → stream → Supabase Storage (persistent copy)
 * Export flow: Supabase Storage → stream → Provider
 */
export class CloudStorageFacade {
  private static providers: Record<CloudProvider, IStorageProvider> = {
    "google-drive": new GoogleDriveProvider(),
    onedrive: new OneDriveProvider(),
    supabase: new SupabaseProvider(),
  };

  static getProvider(name: CloudProvider): IStorageProvider {
    return this.providers[name];
  }

  /**
   * List files from a cloud provider.
   */
  static async listFiles(
    provider: CloudProvider,
    userId: string,
    folderId?: string,
  ): Promise<ProviderFile[]> {
    return this.getProvider(provider).listFiles(userId, folderId);
  }

  /**
   * Import a file from a cloud provider into Supabase Storage.
   * This creates a persistent copy in Supabase and a File record in the database.
   */
  static async importFromProvider(
    provider: CloudProvider,
    userId: string,
    fileId: string,
    projectId: string,
  ) {
    const source = this.getProvider(provider);
    const supabase = this.getProvider("supabase");

    // 1. Download from source provider
    const { stream, fileName, mimeType } = await source.downloadFile(userId, fileId);

    // 2. Stream to temp file for size check
    const fs = await import("fs");
    const path = await import("path");
    const { promisify } = await import("util");
    const { pipeline } = await import("stream");
    const streamPipeline = promisify(pipeline);

    const uploadDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const tempPath = path.join(uploadDir, `import-${Date.now()}-${fileName}`);
    await streamPipeline(stream, fs.createWriteStream(tempPath));

    const fileSize = fs.statSync(tempPath).size;

    // 3. Check storage limit
    const storageInfo = await StorageService.getUserStorageInfo(userId);
    const fileSizeInMB = fileSize / (1024 * 1024);
    const newStorageUsed = storageInfo.used + fileSizeInMB;

    if (newStorageUsed > storageInfo.limit) {
      fs.unlinkSync(tempPath);
      throw new Error("Storage limit exceeded. Please upgrade your plan for more space.");
    }

    // 4. Upload to Supabase
    const readStream = fs.createReadStream(tempPath);
    const uploadResult = await supabase.uploadFile(userId, fileName, readStream, mimeType);

    // 5. Clean up temp file
    fs.unlinkSync(tempPath);

    // 6. Create file record
    const fileRecord = await prisma.file.create({
      data: {
        user_id: userId,
        project_id: projectId,
        file_name: fileName,
        file_path: uploadResult.path,
        file_type: mimeType,
        file_size: fileSize,
        metadata: {
          source: provider,
          originalFileId: fileId,
          publicUrl: uploadResult.publicUrl,
        },
      },
    });

    // 7. Update storage usage
    await prisma.user.update({
      where: { id: userId },
      data: { storage_used: newStorageUsed },
    });

    logger.info("File imported via facade", {
      userId,
      projectId,
      provider,
      fileId: fileRecord.id,
      fileName,
      fileSize,
    });

    return fileRecord;
  }

  /**
   * Export a project's file from Supabase Storage to a cloud provider.
   */
  static async exportToProvider(
    provider: CloudProvider,
    userId: string,
    projectId: string,
  ): Promise<ProviderUploadResult> {
    const supabase = this.getProvider("supabase");
    const target = this.getProvider(provider);

    // 1. Find the project's primary file
    const fileRecord = await prisma.file.findFirst({
      where: { project_id: projectId, user_id: userId },
      orderBy: { uploaded_at: "desc" },
    });

    if (!fileRecord) {
      throw new Error("No file found for this project");
    }

    // 2. Download from Supabase
    const { stream, fileName, mimeType } = await supabase.downloadFile(userId, fileRecord.id);

    // 3. Upload to target provider
    return target.uploadFile(userId, fileName, stream, mimeType);
  }
}
