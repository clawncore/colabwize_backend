import { prisma } from "../lib/prisma";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SecretsService } from "./secrets-service";
import crypto from "crypto";

const BUCKET_NAME = "uploads";

export class ContactEvidenceService {
  private static supabase: SupabaseClient | null = null;

  private static async getClient(): Promise<SupabaseClient> {
    if (this.supabase) return this.supabase;

    const supabaseUrl = await SecretsService.getSupabaseUrl();
    const supabaseServiceKey = await SecretsService.getSupabaseServiceRoleKey();

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase credentials not configured");
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
    return this.supabase;
  }

  static async uploadEvidence(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    ticketNumber: string
  ): Promise<{ fileUrl: string; fileName: string; fileType: string; fileSize: number }> {
    const client = await this.getClient();

    const extension = fileName.split(".").pop() || "bin";
    const fileUuid = crypto.randomUUID();
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

  static async attachToContactRequest(
    contactRequestId: string,
    files: { fileUrl: string; fileName: string; fileType: string; fileSize: number }[]
  ) {
    await prisma.contactAttachment.createMany({
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
