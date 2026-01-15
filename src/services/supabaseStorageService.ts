import { createClient } from "@supabase/supabase-js";
import logger from "../monitoring/logger";
import { prisma } from "../lib/prisma";
import { SecretsService } from "./secrets-service";

interface UploadResult {
  url: string;
  publicUrl: string;
  path: string;
}

interface FileMetadata {
  userId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  projectId?: string;
  createdAt: Date;
}

export class SupabaseStorageService {
  private static supabaseInstance: any = null;

  private static async getSupabaseClient() {
    if (!this.supabaseInstance) {
      const url = await SecretsService.getSupabaseUrl();
      const key = await SecretsService.getSupabaseServiceRoleKey();

      if (!url || !key) {
        throw new Error("Supabase credentials not configured");
      }

      this.supabaseInstance = createClient(url, key);
    }
    return this.supabaseInstance;
  }

  /**
   * Ensure the uploads bucket exists
   */
  private static async ensureBucketExists(): Promise<void> {
    try {
      const client = await this.getSupabaseClient();
      const { data: buckets, error } = await client.storage.listBuckets();

      if (error) {
        logger.error("Error listing buckets", { error });
        return;
      }

      const bucketExists = buckets?.some((b: any) => b.name === "uploads");

      if (!bucketExists) {
        logger.info("Uploads bucket not found, creating it...");
        const client = await this.getSupabaseClient();
        const { error: createError } = await client.storage.createBucket(
          "uploads",
          {
            public: true,
            fileSizeLimit: 52428800, // 50MB
          }
        );

        if (createError) {
          logger.error("Error creating uploads bucket", {
            error: createError,
          });
        } else {
          logger.info("Documents bucket created successfully");
        }
      }
    } catch (error) {
      logger.error("Error ensuring bucket exists", { error });
    }
  }

  /**
   * Upload a file to Supabase storage
   */
  static async uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    userId: string,
    metadata?: FileMetadata
  ): Promise<UploadResult> {
    try {
      // Create a unique filename with timestamp and user ID
      const timestamp = Date.now();
      const uniqueFileName = `${userId}/${timestamp}_${fileName}`;

      // Upload to Supabase storage
      const client = await this.getSupabaseClient();
      let { data, error } = await client.storage
        .from("uploads") // Use the uploads bucket
        .upload(uniqueFileName, fileBuffer, {
          contentType: mimeType,
          upsert: false, // Don't overwrite existing files
        });

      // If bucket not found, try to create it and retry upload
      if (error && error.message.includes("Bucket not found")) {
        await this.ensureBucketExists();

        // Retry upload
        const retryResult = await client.storage
          .from("uploads")
          .upload(uniqueFileName, fileBuffer, {
            contentType: mimeType,
            upsert: false,
          });

        data = retryResult.data;
        error = retryResult.error;
      }

      if (error) {
        logger.error("Supabase upload error", {
          error: error.message,
          fileName,
          userId,
        });
        throw new Error(`Upload failed: ${error.message}`);
      }

      // Get the public URL
      const {
        data: { publicUrl },
      } = client.storage.from("uploads").getPublicUrl(uniqueFileName);

      // Store file metadata in the database if provided
      if (metadata) {
        await prisma.file.create({
          data: {
            user_id: userId,
            project_id: metadata.projectId,
            file_name: fileName,
            file_path: uniqueFileName,
            file_type: metadata.fileType,
            file_size: metadata.fileSize,
            uploaded_at: metadata.createdAt,
            metadata: metadata,
          },
        });
      }

      logger.info("File uploaded successfully", {
        userId,
        fileName,
        fileSize: fileBuffer.length,
        filePath: uniqueFileName,
      });

      return {
        url: data!.path, // data is not null if error is null, ! assertion safe here
        publicUrl,
        path: uniqueFileName,
      };
    } catch (error: any) {
      logger.error("Error uploading file to Supabase", {
        error: error.message,
        fileName,
        userId,
      });
      throw error;
    }
  }

  /**
   * Download a file from Supabase storage
   */
  static async downloadFile(filePath: string): Promise<Buffer> {
    try {
      const client = await this.getSupabaseClient();
      const { data, error } = await client.storage
        .from("uploads")
        .download(filePath);

      if (error) {
        logger.error("Supabase download error", {
          error: error.message,
          filePath,
        });
        throw new Error(`Download failed: ${error.message}`);
      }

      return Buffer.from(await data.arrayBuffer());
    } catch (error: any) {
      logger.error("Error downloading file from Supabase", {
        error: error.message,
        filePath,
      });
      throw error;
    }
  }

  /**
   * Delete a file from Supabase storage
   */
  static async deleteFile(filePath: string): Promise<boolean> {
    try {
      const client = await this.getSupabaseClient();
      const { error } = await client.storage.from("uploads").remove([filePath]);

      if (error) {
        logger.error("Supabase delete error", {
          error: error.message,
          filePath,
        });
        throw new Error(`Delete failed: ${error.message}`);
      }

      // Also delete from database
      await prisma.file.deleteMany({
        where: { file_path: filePath },
      });

      logger.info("File deleted successfully", {
        filePath,
      });

      return true;
    } catch (error: any) {
      logger.error("Error deleting file from Supabase", {
        error: error.message,
        filePath,
      });
      return false;
    }
  }

  /**
   * Get file public URL
   */
  static async getFilePublicUrl(filePath: string): Promise<string> {
    const client = await this.getSupabaseClient();
    const {
      data: { publicUrl },
    } = client.storage.from("uploads").getPublicUrl(filePath);

    return publicUrl;
  }

  /**
   * Create a signed URL for a file
   */
  static async createSignedUrl(
    filePath: string,
    expiresIn: number = 60
  ): Promise<string> {
    const client = await this.getSupabaseClient();
    const { data, error } = await client.storage
      .from("uploads")
      .createSignedUrl(filePath, expiresIn);

    if (error) {
      logger.error("Error creating signed URL", { error, filePath });
      throw new Error("Failed to create signed URL");
    }

    return data.signedUrl;
  }
}
