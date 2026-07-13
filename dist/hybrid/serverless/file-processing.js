"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.default = fileProcessing;
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const exportService_1 = require("../../services/exportService");
const storageService_1 = require("../../services/storageService");
async function fileProcessing(req) {
    try {
        const requestData = (await req.json());
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
        return new Response(JSON.stringify({
            success: true,
            result,
            message: "File processed successfully",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    catch (error) {
        logger_1.default.error("File processing failed", { error: error.message });
        return new Response(JSON.stringify({
            success: false,
            message: error.message || "File processing failed",
        }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}
// Process document import
async function processDocumentImport(fileData, userId) {
    try {
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user)
            throw new Error("User not found");
        const storageInfo = await storageService_1.StorageService.getUserStorageInfo(userId);
        const newStorageUsed = storageInfo.used + 0.01;
        if (newStorageUsed > storageInfo.limit) {
            throw new Error("Storage limit exceeded");
        }
        const project = await prisma_1.prisma.project.create({
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
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: { storage_used: newStorageUsed },
        });
        logger_1.default.info("Document imported successfully", {
            projectId: project.id,
            userId,
        });
        return {
            projectId: project.id,
            wordCount: project.word_count,
            processedAt: new Date().toISOString(),
        };
    }
    catch (error) {
        logger_1.default.error("Error processing document import", { error });
        throw error;
    }
}
// Unified export implementation
async function handleDirectExport(fileData, userId, format) {
    try {
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: userId },
            include: { subscription: true },
        });
        if (!user)
            throw new Error("User not found");
        if (format === "pdf") {
            const isPaid = user.subscription?.status === "active" && user.subscription?.plan !== "free";
            if (!isPaid) {
                // Flat 1 credit charge for free users, unlimited if paid. Uses the
                // ledger-based reserve path so the spend is idempotent and rolls back
                // via refundCredits if the export fails.
                const { CreditService } = await import("../../services/CreditService.js");
                const COST = 1;
                if (!(await CreditService.hasEnoughCredits(userId, COST))) {
                    throw new Error("INSUFFICIENT_CREDITS");
                }
                await CreditService.reserveCredits(userId, COST, `export_pdf_${userId}`);
            }
        }
        const title = fileData.title || "Document";
        const htmlContent = fileData.htmlContent;
        if (!htmlContent) {
            throw new Error("Missing HTML content for direct export path");
        }
        const exportResult = await exportService_1.ExportService.exportProject(fileData.projectId || fileData.id || "temp-export", userId, {
            format,
            htmlContent,
            metadata: fileData.metadata
        });
        const extension = format;
        const contentType = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const sanitizedTitle = title.replace(/[^a-zA-Z0-9-_]/g, "_");
        logger_1.default.info(`${format.toUpperCase()} export generated successfully`, { userId, fileSize: exportResult.fileSize });
        return new Response(exportResult.buffer, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename="${sanitizedTitle}.${extension}"`,
                "Content-Length": exportResult.fileSize.toString(),
            },
        });
    }
    catch (error) {
        logger_1.default.error(`Error generating ${format} export`, { error });
        throw error;
    }
}
exports.config = {
    runtime: "nodejs18.x",
};
