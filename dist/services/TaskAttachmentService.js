"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskAttachmentService = void 0;
const prisma_1 = require("../lib/prisma");
const supabaseStorageService_1 = require("./supabaseStorageService");
const client_1 = require("../lib/supabase/client");
const logger_1 = __importDefault(require("../monitoring/logger"));
class TaskAttachmentService {
    /**
     * Upload an attachment for a task
     */
    static async uploadAttachment(taskId, userId, fileBuffer, fileName, mimeType) {
        try {
            // 1. Upload to Supabase Storage
            const { url, path: filePath } = await supabaseStorageService_1.SupabaseStorageService.uploadFile(fileBuffer, fileName, mimeType, userId);
            // Get file size from the input buffer
            const fileSize = fileBuffer.length;
            // 2. Save metadata to database
            const attachment = await prisma_1.prisma.taskAttachment.create({
                data: {
                    task_id: taskId,
                    name: fileName,
                    file_url: url,
                    file_type: mimeType,
                    file_size: fileSize,
                },
            });
            logger_1.default.info(`Attachment uploaded for task ${taskId}`, {
                attachmentId: attachment.id,
                fileName,
            });
            return attachment;
        }
        catch (error) {
            logger_1.default.error(`Error uploading attachment for task ${taskId}:`, error);
            throw error;
        }
    }
    /**
     * Delete an attachment
     */
    static async deleteAttachment(attachmentId) {
        try {
            const attachment = await prisma_1.prisma.taskAttachment.findUnique({
                where: { id: attachmentId },
            });
            if (!attachment) {
                throw new Error("Attachment not found");
            }
            let filePath;
            if (attachment.file_url.startsWith("http://") ||
                attachment.file_url.startsWith("https://")) {
                const url = new URL(attachment.file_url);
                const urlParts = url.pathname.split("/");
                const uploadsIndex = urlParts.indexOf("uploads");
                filePath = urlParts.slice(uploadsIndex + 1).join("/");
            }
            else {
                // Relative path stored directly
                filePath = attachment.file_url;
            }
            await supabaseStorageService_1.SupabaseStorageService.deleteFile(filePath);
            await prisma_1.prisma.taskAttachment.delete({
                where: { id: attachmentId },
            });
            logger_1.default.info(`Attachment ${attachmentId} deleted successfully`);
            return true;
        }
        catch (error) {
            logger_1.default.error(`Error deleting attachment ${attachmentId}:`, error);
            throw error;
        }
    }
    /**
     * Get an attachment by ID
     */
    static async getAttachmentById(id) {
        try {
            return await prisma_1.prisma.taskAttachment.findUnique({
                where: { id },
            });
        }
        catch (error) {
            logger_1.default.error(`Error fetching attachment ${id}:`, error);
            throw error;
        }
    }
    /**
     * Download an attachment from storage
     */
    static async downloadAttachment(attachmentId) {
        try {
            const attachment = await this.getAttachmentById(attachmentId);
            if (!attachment)
                throw new Error("Attachment not found");
            let filePath;
            if (attachment.file_url.startsWith("http://") ||
                attachment.file_url.startsWith("https://")) {
                // Full URL — extract relative storage path
                const url = new URL(attachment.file_url);
                const urlParts = url.pathname.split("/");
                const uploadsIndex = urlParts.indexOf("uploads");
                filePath = urlParts.slice(uploadsIndex + 1).join("/");
            }
            else {
                // Relative path stored directly (e.g. "userId/timestamp_filename.pdf")
                filePath = attachment.file_url;
            }
            const client = await (0, client_1.getSupabaseAdminClient)();
            if (!client)
                throw new Error("Storage client not available");
            const { data, error } = await client.storage
                .from("uploads")
                .download(filePath);
            if (error)
                throw error;
            const arrayBuffer = await data.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            return {
                data: buffer,
                mimeType: attachment.file_type,
            };
        }
        catch (error) {
            logger_1.default.error(`Error downloading attachment ${attachmentId}:`, error);
            throw error;
        }
    }
    /**
     * Get all attachments for a task
     */
    static async getTaskAttachments(taskId) {
        try {
            return await prisma_1.prisma.taskAttachment.findMany({
                where: { task_id: taskId },
                orderBy: { created_at: "desc" },
            });
        }
        catch (error) {
            logger_1.default.error(`Error fetching attachments for task ${taskId}:`, error);
            throw error;
        }
    }
}
exports.TaskAttachmentService = TaskAttachmentService;
