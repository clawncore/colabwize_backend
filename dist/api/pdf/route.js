"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPLOAD_PDF = UPLOAD_PDF;
exports.CHAT_PDF = CHAT_PDF;
exports.GET_PDFS = GET_PDFS;
exports.GET_PDF = GET_PDF;
exports.GET_PDF_DOWNLOAD = GET_PDF_DOWNLOAD;
exports.GET_PDF_RELATED = GET_PDF_RELATED;
const pdfService_1 = require("../../services/pdfService");
const vectorStoreService_1 = require("../../services/vectorStoreService");
const client_1 = require("../../lib/supabase/client");
// @ts-ignore
const openai_1 = require("@langchain/openai");
const messages_1 = require("@langchain/core/messages");
const uuid_1 = require("uuid");
const secrets_service_1 = require("../../services/secrets-service");
const prisma_1 = require("../../lib/prisma");
const paperRecommendationService_1 = require("../../services/paperRecommendationService");
const api_response_1 = require("../../lib/api-response");
// POST /api/pdf/upload
async function UPLOAD_PDF(req, res) {
    try {
        const file = req.file;
        if (!file) {
            return (0, api_response_1.sendErrorResponse)(res, 400, "No file uploaded");
        }
        let userId = req.user?.id;
        if (!userId) {
            return (0, api_response_1.sendErrorResponse)(res, 401, "Unauthorized: no user found in request");
        }
        console.log("2. Final User ID:", userId);
        // --- Subscription Limits Check ---
        const userSubscription = await prisma_1.prisma.subscription.findUnique({
            where: { user_id: userId },
        });
        const plan = userSubscription?.plan?.toLowerCase() || "free";
        // 1. Check if user can access PDF chat at all
        if (plan === "free") {
            return (0, api_response_1.sendErrorResponse)(res, 403, "PDF_CHAT_LOCKED", "PDF Chat is only available on Plus and Premium plans.");
        }
        // 2. Check document count limit
        const pdfCount = await prisma_1.prisma.pdfDocument.count({
            where: { user_id: userId },
        });
        const countLimit = plan === "premium" ? 30 : 10;
        if (pdfCount >= countLimit) {
            return (0, api_response_1.sendErrorResponse)(res, 403, "PDF_LIMIT_REACHED", {
                message: `You have reached the limit of ${countLimit} PDFs for your ${plan} plan.`,
                limit: countLimit,
            });
        }
        // 3. Check file size limit
        const sizeLimitMB = plan === "premium" ? 100 : 50;
        const sizeLimitBytes = sizeLimitMB * 1024 * 1024;
        if (file.size > sizeLimitBytes) {
            return (0, api_response_1.sendErrorResponse)(res, 403, "FILE_SIZE_EXCEEDED", {
                message: `File size exceeds the ${sizeLimitMB}MB limit for your ${plan} plan.`,
                limit: sizeLimitMB,
            });
        }
        // --- End Subscription Limits Check ---
        const { originalname, buffer } = file;
        console.log("1. Extracting text from PDF...");
        const text = await pdfService_1.PdfService.extractText(buffer);
        // 1. Store file metadata in DB using admin client (bypasses RLS)
        console.log("3. Getting admin client...");
        const client = await (0, client_1.getSupabaseAdminClient)();
        if (!client) {
            console.error("Admin client is null!");
            return (0, api_response_1.sendErrorResponse)(res, 500, "Database admin client not configured");
        }
        console.log("4. Admin client obtained");
        const docId = (0, uuid_1.v4)(); // Generate UUID explicitly
        console.log("5. Uploading file to storage...");
        // Ensure bucket exists
        try {
            const { data: buckets } = await client.storage.listBuckets();
            if (!buckets?.find((b) => b.name === "uploads")) {
                console.log("Creating 'uploads' bucket...");
                const { error: createBucketError } = await client.storage.createBucket("uploads", {
                    public: false,
                    fileSizeLimit: 10485760, // 10MB limit (optional)
                });
                if (createBucketError) {
                    console.error("Failed to create bucket:", createBucketError);
                }
            }
        }
        catch (bucketCheckError) {
            console.error("Error checking buckets:", bucketCheckError);
        }
        // Upload to Supabase Storage
        // Path: {userId}/{docId}.pdf
        const storagePath = `${userId}/${docId}.pdf`;
        const { error: uploadError } = await client.storage
            .from("uploads")
            .upload(storagePath, buffer, {
            contentType: "application/pdf",
            upsert: true,
        });
        if (uploadError) {
            console.error("Storage upload error:", uploadError);
            // Determine if it's a "Bucket not found" error and try to create it?
            // For now just throw
            throw new Error(`Failed to upload to storage: ${uploadError.message}`);
        }
        console.log("6. Inserting PDF metadata using Prisma...");
        const now = new Date();
        const doc = await prisma_1.prisma.pdfDocument.create({
            data: {
                id: docId,
                filename: originalname,
                user_id: userId,
                status: "processing",
                created_at: now,
                updated_at: now,
            },
        });
        const documentId = doc.id;
        // 2. Vectorize
        const chunks = await pdfService_1.PdfService.chunkText(text, {
            documentId: documentId,
            filename: originalname,
            userId: userId,
        });
        await vectorStoreService_1.VectorStoreService.storeDocuments(chunks);
        // 3. Update status using Prisma
        await prisma_1.prisma.pdfDocument.update({
            where: { id: documentId },
            data: { status: "ready", updated_at: new Date() },
        });
        (0, api_response_1.sendJsonResponse)(res, 200, {
            documentId,
            message: "PDF processed successfully",
        });
    }
    catch (error) {
        console.error("Upload error:", error);
        (0, api_response_1.sendErrorResponse)(res, 500, error.message);
    }
}
// POST /api/pdf/chat
async function CHAT_PDF(req, res) {
    try {
        const { documentId, message } = req.body;
        if (!documentId || !message) {
            return (0, api_response_1.sendErrorResponse)(res, 400, "Missing documentId or message");
        }
        // 1. Retrieve relevant chunks from the vector store
        const docs = await vectorStoreService_1.VectorStoreService.search(message, { documentId });
        // Strict RAG: return early if no relevant context found in the document
        if (docs.length === 0) {
            return (0, api_response_1.sendJsonResponse)(res, 200, {
                answer: "I checked the document but couldn't find any relevant information to answer your question. Try rephrasing or asking about a different part of the document.",
                sources: [],
            });
        }
        // 2. Generate answer using retrieved context
        const apiKey = await secrets_service_1.SecretsService.getOpenAiApiKey();
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY not configured");
        }
        const model = new openai_1.ChatOpenAI({
            temperature: 0,
            modelName: "gpt-4o",
            openAIApiKey: apiKey,
        });
        const context = docs.map((d) => d.pageContent).join("\n\n");
        const systemPrompt = `You are a helpful AI research assistant. Use the following context from an uploaded PDF to answer the user's question.
If the answer is not in the context, say so clearly, but you may offer general knowledge if explicitly asked.
Cite the context where possible.

Context:
${context}`;
        // @ts-ignore
        const response = await model.invoke([
            new messages_1.SystemMessage(systemPrompt),
            new messages_1.HumanMessage(message),
        ]);
        const answer = typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);
        (0, api_response_1.sendJsonResponse)(res, 200, {
            answer,
            sources: docs.map((d) => d.pageContent),
        });
    }
    catch (error) {
        console.error("Chat error:", error);
        (0, api_response_1.sendErrorResponse)(res, 500, error.message);
    }
}
// GET /api/pdf
async function GET_PDFS(req, res) {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return (0, api_response_1.sendErrorResponse)(res, 401, "Unauthorized");
        }
        const pdfs = await prisma_1.prisma.pdfDocument.findMany({
            where: { user_id: userId },
            orderBy: { created_at: "desc" },
        });
        (0, api_response_1.sendJsonResponse)(res, 200, pdfs);
    }
    catch (error) {
        console.error("Get PDFs error:", error);
        (0, api_response_1.sendErrorResponse)(res, 500, error.message);
    }
}
// GET /api/pdf/:id
async function GET_PDF(req, res) {
    try {
        const { id } = req.params;
        const pdf = await prisma_1.prisma.pdfDocument.findUnique({
            where: { id },
        });
        if (!pdf) {
            return (0, api_response_1.sendErrorResponse)(res, 404, "Document not found");
        }
        (0, api_response_1.sendJsonResponse)(res, 200, pdf);
    }
    catch (error) {
        console.error("Get PDF error:", error);
        (0, api_response_1.sendErrorResponse)(res, 500, error.message);
    }
}
// GET /api/pdf/:id/download
async function GET_PDF_DOWNLOAD(req, res) {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        if (!userId) {
            return (0, api_response_1.sendErrorResponse)(res, 401, "Unauthorized");
        }
        // Verify ownership
        const pdf = await prisma_1.prisma.pdfDocument.findFirst({
            where: { id, user_id: userId },
        });
        if (!pdf) {
            return (0, api_response_1.sendErrorResponse)(res, 404, "Document not found or access denied");
        }
        const client = await (0, client_1.getSupabaseAdminClient)();
        if (!client) {
            return (0, api_response_1.sendErrorResponse)(res, 500, "Storage client not available");
        }
        const storagePath = `${userId}/${id}.pdf`;
        // Download from Supabase Storage
        const { data, error } = await client.storage
            .from("uploads")
            .download(storagePath);
        if (error) {
            console.error("Download error:", error);
            return (0, api_response_1.sendErrorResponse)(res, 500, "Failed to retrieve file");
        }
        // Convert Blob/File to Buffer
        const arrayBuffer = await data.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${pdf.filename}"`);
        res.send(buffer);
    }
    catch (error) {
        console.error("Download PDF error:", error);
        (0, api_response_1.sendErrorResponse)(res, 500, error.message);
    }
}
// GET /api/pdf/:id/related
async function GET_PDF_RELATED(req, res) {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        if (!userId) {
            return (0, api_response_1.sendErrorResponse)(res, 401, "Unauthorized");
        }
        // 1. Get PDF Metadata
        const pdf = await prisma_1.prisma.pdfDocument.findUnique({
            where: { id },
        });
        if (!pdf) {
            return (0, api_response_1.sendErrorResponse)(res, 404, "Document not found");
        }
        // 2. Generate search query from filename (remove .pdf, special chars)
        const query = pdf.filename.replace(/\.pdf$/i, "").replace(/[-_]/g, " ");
        console.log(`Getting related papers for: ${query}`);
        // 3. Search for related papers using PaperRecommendationService
        const papers = await paperRecommendationService_1.PaperRecommendationService.searchPapers(query, {
            maxResults: 6,
        });
        (0, api_response_1.sendJsonResponse)(res, 200, papers);
    }
    catch (error) {
        console.error("Get Related Papers error:", error);
        (0, api_response_1.sendErrorResponse)(res, 500, error.message);
    }
}
