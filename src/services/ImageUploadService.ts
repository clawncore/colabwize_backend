import { prisma } from "../lib/prisma";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import logger from "../monitoring/logger";
import crypto from "crypto";
import { SecretsService } from "./secrets-service";

const BUCKET_NAME = "uploads";

export class ImageUploadService {
    private static supabase: SupabaseClient | null = null;

    /**
     * Lazily initializes the Supabase client using SecretsService
     */
    private static async getClient(): Promise<SupabaseClient> {
        if (this.supabase) return this.supabase;

        const supabaseUrl = await SecretsService.getSupabaseUrl();
        const supabaseServiceKey = await SecretsService.getSupabaseServiceRoleKey();

        if (!supabaseUrl || !supabaseServiceKey) {
            logger.error("Missing Supabase configuration", {
                hasUrl: !!supabaseUrl,
                hasKey: !!supabaseServiceKey
            });
            throw new Error("Supabase credentials not configured");
        }

        this.supabase = createClient(supabaseUrl, supabaseServiceKey);
        return this.supabase;
    }

    /**
     * Verify the storage bucket exists
     */
    static async ensureBucket() {
        try {
            const client = await this.getClient();
            const { data: buckets, error } = await client.storage.listBuckets();

            if (error) {
                logger.error("Failed to list storage buckets", { error });
                throw error;
            }

            const exists = buckets?.some((bucket) => bucket.name === BUCKET_NAME);

            if (!exists) {
                // Optional: Try to create it if we have permissions?
                // For now, just throw as before
                throw new Error(`Storage bucket '${BUCKET_NAME}' does not exist. Please create it in Supabase Dashboard.`);
            }

            logger.info(`Using existing storage bucket: ${BUCKET_NAME}`);
        } catch (error) {
            logger.error("Error verifying bucket exists", { error });
            throw error;
        }
    }

    /**
     * Upload image to Supabase storage
     */
    static async uploadImage(
        buffer: Buffer,
        userId: string,
        projectId: string,
        mimeType: string
    ): Promise<string> {
        try {
            await this.ensureBucket();
            const client = await this.getClient();

            // Generate unique filename
            const extension = mimeType.split("/")[1];
            const imageId = crypto.randomUUID();
            const filePath = `${userId}/${projectId}/${imageId}.${extension}`;

            // Upload to Supabase
            const { data, error } = await client.storage
                .from(BUCKET_NAME)
                .upload(filePath, buffer, {
                    contentType: mimeType,
                    upsert: false,
                });

            if (error) {
                logger.error("Supabase upload failed", { error, filePath });
                throw error;
            }

            // Get public URL
            const { data: urlData } = client.storage
                .from(BUCKET_NAME)
                .getPublicUrl(filePath);

            logger.info("Image uploaded successfully", {
                userId,
                projectId,
                filePath,
                url: urlData.publicUrl,
            });

            return urlData.publicUrl;
        } catch (error) {
            logger.error("Image upload error", { error });
            throw error;
        }
    }

    /**
     * Delete image from storage
     */
    static async deleteImage(imageUrl: string, userId: string): Promise<void> {
        try {
            const client = await this.getClient();

            // Extract file path from URL
            const urlParts = imageUrl.split(`/storage/v1/object/public/${BUCKET_NAME}/`);
            if (urlParts.length < 2) {
                throw new Error("Invalid image URL");
            }

            const filePath = urlParts[1];

            // Verify user owns this image (path should start with userId)
            if (!filePath.startsWith(userId)) {
                throw new Error("Unauthorized: Cannot delete image owned by another user");
            }

            const { error } = await client.storage.from(BUCKET_NAME).remove([filePath]);

            if (error) {
                logger.error("Supabase delete failed", { error, filePath });
                throw error;
            }

            logger.info("Image deleted successfully", { userId, filePath });
        } catch (error) {
            logger.error("Image deletion error", { error });
            throw error;
        }
    }
}
