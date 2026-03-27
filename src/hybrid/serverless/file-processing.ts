import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { ExportService } from "../../services/exportService";
import { StorageService } from "../../services/storageService";

interface FileProcessingRequest {
  json(): Promise<{
    fileData: any;
    fileType: string;
    userId: string;
  }>;
}

export default async function fileProcessing(req: FileProcessingRequest) {
  try {
    const requestData = (await req.json()) as {
      fileData: any;
      fileType: string;
      userId: string;
    };
    const { fileData, fileType, userId } = requestData;

    let result;
    switch (fileType) {
      case "document-import":
        result = await processDocumentImport(fileData, userId);
        break;
      case "export-pdf":
        return await handleDirectExport(fileData, userId, "pdf");
      case "export-docx":
        return await handleDirectExport(fileData, userId, "docx");
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        result,
        message: "File processed successfully",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    logger.error("File processing failed", { error: error.message });
    return new Response(
      JSON.stringify({
        success: false,
        message: error.message || "File processing failed",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Process document import
async function processDocumentImport(fileData: any, userId: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new Error("User not found");

    const storageInfo = await StorageService.getUserStorageInfo(userId);
    const newStorageUsed = storageInfo.used + 0.01;

    if (newStorageUsed > storageInfo.limit) {
      throw new Error("Storage limit exceeded");
    }

    const project = await prisma.project.create({
      data: {
        user_id: userId,
        title: fileData.title || "Imported Document",
        type: fileData.type || "research-paper",
        citation_style: fileData.citationStyle || "apa",
        content: fileData.content || {},
        word_count: fileData.wordCount || 0,
        status: "draft",
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { storage_used: newStorageUsed },
    });

    logger.info("Document imported successfully", {
      projectId: project.id,
      userId,
    });

    return {
      projectId: project.id,
      wordCount: project.word_count,
      processedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error("Error processing document import", { error });
    throw error;
  }
}

// Unified export implementation
async function handleDirectExport(fileData: any, userId: string, format: "pdf" | "docx") {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user) throw new Error("User not found");

    if (format === "pdf") {
      const isPaid = user.subscription?.status === "active" && user.subscription?.plan !== "free";
      if (!isPaid) {
        // Flat 1 credit charge for free users, unlimited if paid
        const { CreditService } = await import("../../services/CreditService.js");
        const balance = await CreditService.getBalance(userId);
        const COST = 1;

        if (balance < COST) throw new Error("INSUFFICIENT_CREDITS");
        await CreditService.addCredits(userId, -COST, "USAGE", `export_pdf_${Date.now()}`, "PDF Export");
      }
    }

    const title = fileData.title || "Document";
    const htmlContent = fileData.htmlContent;
    if (!htmlContent) {
      throw new Error("Missing HTML content for direct export path");
    }

    const exportResult = await ExportService.exportProject(fileData.projectId || fileData.id || "temp-export", userId, {
      format,
      htmlContent,
      metadata: fileData.metadata
    });

    const extension = format;
    const contentType = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9-_]/g, "_");

    logger.info(`${format.toUpperCase()} export generated successfully`, { userId, fileSize: exportResult.fileSize });

    return new Response(exportResult.buffer as any, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${sanitizedTitle}.${extension}"`,
        "Content-Length": exportResult.fileSize.toString(),
      },
    });
  } catch (error: any) {
    logger.error(`Error generating ${format} export`, { error });
    throw error;
  }
}

export const config = {
  runtime: "nodejs18.x",
};
