"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseProvider = void 0;
const stream_1 = require("stream");
const supabaseStorageService_1 = require("../supabaseStorageService");
const prisma_1 = require("../../lib/prisma");
/**
 * Supabase Storage adapter implementing the IStorageProvider interface.
 * This is the primary storage backend — files from Google Drive and OneDrive
 * are imported into Supabase Storage via this provider.
 */
class SupabaseProvider {
    name = "supabase";
    async listFiles(userId, folderId) {
        const files = await prisma_1.prisma.file.findMany({
            where: { user_id: userId, ...(folderId ? { project_id: folderId } : {}) },
            orderBy: { uploaded_at: "desc" },
        });
        return files.map((f) => ({
            id: f.id,
            name: f.file_name,
            mimeType: f.file_type,
            size: f.file_size,
            modifiedTime: f.uploaded_at?.toISOString(),
            webUrl: f.metadata?.publicUrl,
            downloadUrl: null,
        }));
    }
    async downloadFile(userId, fileId) {
        const file = await prisma_1.prisma.file.findFirst({
            where: { id: fileId, user_id: userId },
        });
        if (!file)
            throw new Error("File not found");
        const buffer = await supabaseStorageService_1.SupabaseStorageService.downloadFile(file.file_path);
        const stream = new stream_1.Readable();
        stream.push(buffer);
        stream.push(null);
        return {
            stream,
            fileName: file.file_name,
            mimeType: file.file_type,
        };
    }
    async uploadFile(userId, fileName, stream, mimeType) {
        const result = await supabaseStorageService_1.SupabaseStorageService.uploadFileStream(stream, fileName, mimeType, userId);
        return {
            id: result.path,
            name: fileName,
            path: result.path,
            publicUrl: result.publicUrl,
        };
    }
    async deleteFile(userId, fileId) {
        const file = await prisma_1.prisma.file.findFirst({
            where: { id: fileId, user_id: userId },
        });
        if (!file)
            throw new Error("File not found");
        await supabaseStorageService_1.SupabaseStorageService.deleteFile(file.file_path);
    }
}
exports.SupabaseProvider = SupabaseProvider;
