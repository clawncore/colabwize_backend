"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContactEvidenceService = void 0;
const prisma_1 = require("../lib/prisma");
const supabase_js_1 = require("@supabase/supabase-js");
const secrets_service_1 = require("./secrets-service");
const crypto_1 = __importDefault(require("crypto"));
const BUCKET_NAME = "uploads";
class ContactEvidenceService {
    static supabase = null;
    static async getClient() {
        if (this.supabase)
            return this.supabase;
        const supabaseUrl = await secrets_service_1.SecretsService.getSupabaseUrl();
        const supabaseServiceKey = await secrets_service_1.SecretsService.getSupabaseServiceRoleKey();
        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error("Supabase credentials not configured");
        }
        this.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceKey);
        return this.supabase;
    }
    static async uploadEvidence(buffer, fileName, mimeType, ticketNumber) {
        const client = await this.getClient();
        const extension = fileName.split(".").pop() || "bin";
        const fileUuid = crypto_1.default.randomUUID();
        const filePath = `contact-evidence/${ticketNumber}/${fileUuid}.${extension}`;
        const { error } = await client.storage
            .from(BUCKET_NAME)
            .upload(filePath, buffer, {
            contentType: mimeType,
            upsert: false,
        });
        if (error) {
            throw new Error(`Upload failed: ${error.message}`);
        }
        const { data: urlData } = client.storage
            .from(BUCKET_NAME)
            .getPublicUrl(filePath);
        return {
            fileUrl: urlData.publicUrl,
            fileName,
            fileType: mimeType,
            fileSize: buffer.length,
        };
    }
    static async attachToContactRequest(contactRequestId, files) {
        await prisma_1.prisma.contactAttachment.createMany({
            data: files.map((f) => ({
                contactRequestId,
                file_name: f.fileName,
                file_url: f.fileUrl,
                file_type: f.fileType,
                file_size: f.fileSize,
            })),
        });
    }
}
exports.ContactEvidenceService = ContactEvidenceService;
