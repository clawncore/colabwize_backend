"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseStorageService = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const logger_1 = __importDefault(require("../monitoring/logger"));
const prisma_1 = require("../lib/prisma");
const secrets_service_1 = require("./secrets-service");
class SupabaseStorageService {
    static supabaseInstance = null;
    static async getSupabaseClient() {
        if (!this.supabaseInstance) {
            const url = await secrets_service_1.SecretsService.getSupabaseUrl();
            const key = await secrets_service_1.SecretsService.getSupabaseServiceRoleKey();
            if (!url || !key) {
                throw new Error("Supabase credentials not configured");
            }
            this.supabaseInstance = (0, supabase_js_1.createClient)(url, key);
        }
        return this.supabaseInstance;
    }
    /**
     * Ensure the uploads bucket exists
     */
    static async ensureBucketExists() {
        try {
            const client = await this.getSupabaseClient();
            const { data: buckets, error } = await client.storage.listBuckets();
            if (error) {
                logger_1.default.error("Error listing buckets", { error });
                return;
            }
            const bucketExists = buckets?.some((b) => b.name === "uploads");
            if (!bucketExists) {
                logger_1.default.info("Uploads bucket not found, creating it...");
                const client = await this.getSupabaseClient();
                const { error: createError } = await client.storage.createBucket("uploads", {
                    public: true,
                    fileSizeLimit: 52428800, // 50MB
                });
                if (createError) {
                    logger_1.default.error("Error creating uploads bucket", {
                        error: createError,
                    });
                }
                else {
                    logger_1.default.info("Documents bucket created successfully");
                }
            }
        }
        catch (error) {
            logger_1.default.error("Error ensuring bucket exists", { error });
        }
    }
    /**
     * Upload a file to Supabase storage
     */
    static async uploadFile(fileBuffer, fileName, mimeType, userId, metadata) {
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
                logger_1.default.error("Supabase upload error", {
                    error: error.message,
                    fileName,
                    userId,
                });
                throw new Error(`Upload failed: ${error.message}`);
            }
            // Get the public URL
            const { data: { publicUrl }, } = client.storage.from("uploads").getPublicUrl(uniqueFileName);
            // Store file metadata in the database if provided
            if (metadata) {
                await prisma_1.prisma.file.create({
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
            logger_1.default.info("File uploaded successfully", {
                userId,
                fileName,
                fileSize: fileBuffer.length,
                filePath: uniqueFileName,
            });
            return {
                url: data.path, // data is not null if error is null, ! assertion safe here
                publicUrl,
                path: uniqueFileName,
            };
        }
        catch (error) {
            logger_1.default.error("Error uploading file to Supabase", {
                error: error.message,
                fileName,
                userId,
            });
            throw error;
        }
    }
    /**
     * Upload a file to Supabase storage from a Readable stream.
     * Preferred over uploadFile() for large files to avoid buffering in memory.
     */
    static async uploadFileStream(stream, fileName, mimeType, userId, metadata) {
        try {
            const timestamp = Date.now();
            const uniqueFileName = `${userId}/${timestamp}_${fileName}`;
            const client = await this.getSupabaseClient();
            // Read the stream into a Blob for the Supabase SDK
            const chunks = [];
            await new Promise((resolve, reject) => {
                stream.on("data", (chunk) => chunks.push(chunk));
                stream.on("error", reject);
                stream.on("end", () => resolve());
            });
            const buffer = Buffer.concat(chunks);
            let { data, error } = await client.storage
                .from("uploads")
                .upload(uniqueFileName, buffer, {
                contentType: mimeType,
                upsert: false,
            });
            if (error && error.message.includes("Bucket not found")) {
                await this.ensureBucketExists();
                const retryResult = await client.storage
                    .from("uploads")
                    .upload(uniqueFileName, buffer, {
                    contentType: mimeType,
                    upsert: false,
                });
                data = retryResult.data;
                error = retryResult.error;
            }
            if (error) {
                logger_1.default.error("Supabase upload stream error", {
                    error: error.message,
                    fileName,
                    userId,
                });
                throw new Error(`Upload failed: ${error.message}`);
            }
            const { data: { publicUrl }, } = client.storage.from("uploads").getPublicUrl(uniqueFileName);
            if (metadata) {
                await prisma_1.prisma.file.create({
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
            logger_1.default.info("File uploaded via stream successfully", {
                userId,
                fileName,
                fileSize: buffer.length,
                filePath: uniqueFileName,
            });
            return {
                url: data.path,
                publicUrl,
                path: uniqueFileName,
            };
        }
        catch (error) {
            logger_1.default.error("Error uploading file stream to Supabase", {
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
    static async downloadFile(filePath) {
        try {
            const client = await this.getSupabaseClient();
            const { data, error } = await client.storage
                .from("uploads")
                .download(filePath);
            if (error) {
                logger_1.default.error("Supabase download error", {
                    error: error.message,
                    filePath,
                });
                throw new Error(`Download failed: ${error.message}`);
            }
            return Buffer.from(await data.arrayBuffer());
        }
        catch (error) {
            logger_1.default.error("Error downloading file from Supabase", {
                error: error.message,
                filePath,
            });
            throw error;
        }
    }
    /**
     * Delete a file from Supabase storage
     */
    static async deleteFile(filePath) {
        try {
            const client = await this.getSupabaseClient();
            const { error } = await client.storage.from("uploads").remove([filePath]);
            if (error) {
                logger_1.default.error("Supabase delete error", {
                    error: error.message,
                    filePath,
                });
                throw new Error(`Delete failed: ${error.message}`);
            }
            // Also delete from database
            await prisma_1.prisma.file.deleteMany({
                where: { file_path: filePath },
            });
            logger_1.default.info("File deleted successfully", {
                filePath,
            });
            return true;
        }
        catch (error) {
            logger_1.default.error("Error deleting file from Supabase", {
                error: error.message,
                filePath,
            });
            return false;
        }
    }
    /**
     * Get file public URL
     */
    static async getFilePublicUrl(filePath) {
        const client = await this.getSupabaseClient();
        const { data: { publicUrl }, } = client.storage.from("uploads").getPublicUrl(filePath);
        return publicUrl;
    }
    /**
     * Create a signed URL for a file
     */
    static async createSignedUrl(filePath, expiresIn = 60, options // Add options parameter
    ) {
        const client = await this.getSupabaseClient();
        const signedUrlOptions = {};
        if (options?.download) {
            signedUrlOptions.download = options.download;
        }
        const { data, error } = await client.storage
            .from("uploads")
            .createSignedUrl(filePath, expiresIn, signedUrlOptions);
        if (error) {
            logger_1.default.error("Error creating signed URL", { error, filePath });
            throw new Error("Failed to create signed URL");
        }
        return data.signedUrl;
    }
}
exports.SupabaseStorageService = SupabaseStorageService;
