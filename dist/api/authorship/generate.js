"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCertificate = void 0;
const prisma_1 = require("../../lib/prisma");
const client_1 = require("../../lib/supabase/client");
const authorshipCertificateGenerator_1 = require("../../services/authorshipCertificateGenerator");
const authorshipConfidenceService_1 = require("../../services/authorshipConfidenceService");
const subscriptionService_1 = require("../../services/subscriptionService");
const crypto_1 = require("crypto");
const secrets_service_1 = require("../../services/secrets-service");
const BillingGateway_1 = require("../../billing/BillingGateway");
const generateCertificate = async (req, res) => {
    try {
        // Get user from authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res
                .status(401)
                .json({ error: "Missing or invalid authorization header" });
        }
        const token = authHeader.substring(7);
        // Verify token
        let user;
        try {
            const client = await (0, client_1.getSupabaseClient)();
            if (!client) {
                return res
                    .status(500)
                    .json({ error: "Supabase client not initialized" });
            }
            const { data: { user: userData }, error, } = await client.auth.getUser(token);
            if (error || !userData) {
                return res.status(401).json({ error: "Invalid or expired token" });
            }
            user = userData;
        }
        catch (error) {
            return res.status(401).json({ error: "Invalid or expired token" });
        }
        const { projectId, certificateType = "authorship", includeQRCode = true, } = req.body;
        if (!projectId) {
            return res.status(400).json({ error: "Project ID is required" });
        }
        // Get Project and User details
        const project = await prisma_1.prisma.project.findUnique({
            where: { id: projectId },
        });
        // Check if project exists and belongs to user (or user is collaborator)
        if (!project) {
            return res.status(404).json({ error: "Project not found" });
        }
        // Simple ownership check for MVP
        if (project.user_id !== user.id) {
            // Ideally check collaborators too, but for strict MVP ownership is safer
            return res.status(403).json({ error: "Unauthorized access to project" });
        }
        const prismaUser = await prisma_1.prisma.user.findUnique({ where: { id: user.id } });
        if (!prismaUser) {
            return res.status(404).json({ error: "User profile not found" });
        }
        // Fetch plan details for metadata and watermark logic
        const plan = await subscriptionService_1.SubscriptionService.getActivePlan(user.id);
        const limits = subscriptionService_1.SubscriptionService.getPlanLimits(plan);
        // Run the entire generation through the single billing pipeline. The
        // gateway holds certificate quota, runs generation, then confirms on
        // success or releases the hold on failure (including timeouts). This is
        // the correct lifecycle: the user is only charged for a certificate that
        // actually completed.
        try {
            await BillingGateway_1.BillingGateway.withFeature(user.id, "certificate", undefined, async () => {
                // Generate Certificate HTML (reuse for both PDF and preview)
                const stats = await import("../../services/authorshipReportService.js").then((m) => m.AuthorshipReportService.generateAuthorshipReport(projectId, user.id));
                const confidenceReport = await authorshipConfidenceService_1.AuthorshipConfidenceService.generateProjectReport(projectId, user.id);
                const frontendUrl = await secrets_service_1.SecretsService.getFrontendUrl();
                const qrCodeDataUrl = includeQRCode
                    ? await import("qrcode").then((qr) => qr.default.toDataURL(`${frontendUrl}/verify/${projectId}`, {
                        errorCorrectionLevel: "H",
                        margin: 1,
                        width: 200,
                        color: { dark: "#000000", light: "#FFFFFF" },
                    }))
                    : null;
                // Generate HTML first
                const html = await authorshipCertificateGenerator_1.AuthorshipCertificateGenerator.generateCertificateHTML({
                    projectId,
                    userId: user.id,
                    userName: prismaUser.full_name || "ColabWize User",
                    projectTitle: project.title || "Untitled Project",
                    certificateType,
                    includeQRCode,
                    verificationUrl: `${frontendUrl}/verify/${projectId}`,
                    watermark: limits.watermark,
                    confidenceReport,
                }, stats, qrCodeDataUrl);
                // Generate PDF from HTML
                const buffer = await authorshipCertificateGenerator_1.AuthorshipCertificateGenerator.convertHTMLToPDF(html);
                // Generate preview image from same HTML
                const previewBuffer = await authorshipCertificateGenerator_1.AuthorshipCertificateGenerator.generatePreviewImage(html);
                // Upload PDF to Supabase
                const fileName = `certificate-${projectId}-${(0, crypto_1.randomUUID)()}.pdf`;
                const { path: pdfPath } = await import("../../services/supabaseStorageService.js").then((m) => m.SupabaseStorageService.uploadFile(buffer, fileName, "application/pdf", user.id, {
                    userId: user.id,
                    fileName: fileName,
                    fileType: "application/pdf",
                    fileSize: buffer.length,
                    projectId: projectId,
                    createdAt: new Date(),
                }));
                // Upload Preview Image to Supabase
                const previewFileName = `preview-${projectId}-${(0, crypto_1.randomUUID)()}.png`;
                const { publicUrl: previewPublicUrl } = await import("../../services/supabaseStorageService.js").then((m) => m.SupabaseStorageService.uploadFile(previewBuffer, previewFileName, "image/png", user.id, {
                    userId: user.id,
                    fileName: previewFileName,
                    fileType: "image/png",
                    fileSize: previewBuffer.length,
                    projectId: projectId,
                    createdAt: new Date(),
                }));
                // Create Certificate Record with preview URL
                await prisma_1.prisma.certificate.create({
                    data: {
                        user_id: user.id,
                        project_id: projectId,
                        title: `${certificateType} Certificate - ${project.title}`,
                        file_name: fileName,
                        file_path: pdfPath, // Path in Supabase bucket
                        file_size: buffer.length,
                        status: "completed",
                        certificate_type: certificateType,
                        metadata: {
                            generated_at: new Date().toISOString(),
                            plan_at_generation: plan,
                            previewUrl: previewPublicUrl, // Public URL for frontend display
                            confidenceReport: {
                                overallReliability: confidenceReport.overallReliability.label,
                                overallReliabilityScore: confidenceReport.overallReliability.score,
                                attributionConfidence: confidenceReport.attributionConfidence.score,
                                contributionConfidence: confidenceReport.contributionConfidence.score,
                                collaborationClarity: confidenceReport.collaborationClarity.score,
                                evidenceCompleteness: confidenceReport.evidenceCompleteness.score,
                                aiTransparency: confidenceReport.aiAssistanceTransparency.score,
                                anomalyRisk: confidenceReport.anomalyRisk.score,
                                evidenceSummary: confidenceReport.evidenceSummary,
                            },
                        },
                    },
                });
                // Send PDF buffer directly
                res.setHeader("Content-Type", "application/pdf");
                res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
                res.setHeader("Content-Length", buffer.length);
                return res.send(buffer);
            });
            return;
        }
        catch (innerError) {
            if (innerError instanceof BillingGateway_1.BillingError) {
                const status = innerError.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
                return res.status(status).json({
                    success: false,
                    message: innerError.message || "Monthly limit reached",
                    code: innerError.code,
                    ...innerError.data,
                });
            }
            console.error("Generation internal error:", innerError);
            // TIMEOUT MAPPING RULE
            const isTimeout = innerError.message?.includes("timeout") || innerError.name === "TimeoutError";
            if (isTimeout) {
                // Master Prompt Rule 4: If timeout occurs, assuming limits might be tight or system stressed,
                // check limits one last time or default to limit error rather than "Technical Timeout".
                // Actually, if it's a timeout, it likely means the heavier operations failed.
                // We map this to PLAN_LIMIT_REACHED to prompt upgrade/support rather than showing "Navigation Timeout".
                return res.status(403).json({
                    error: "Generation timed out. This may be due to high demand.",
                    code: "PLAN_LIMIT_REACHED", // Treating as resource exhaustion
                    data: { upgrade_url: "/pricing" }
                });
            }
            const isMissingBrowser = innerError.message?.includes("Could not find Chrome") ||
                innerError.message?.includes("Failed to launch the browser process");
            // Genuine System Failure
            return res.status(500).json({
                error: isMissingBrowser
                    ? "Certificate generation requires a local Chrome/Chromium browser for PDF rendering. Re-run backend postinstall or install Chrome."
                    : "We couldn't complete this request due to a system issue.",
                code: isMissingBrowser ? "PUPPETEER_BROWSER_MISSING" : "GENERATION_FAILED"
            });
        }
    }
    catch (error) {
        console.error("Error generating certificate [Top Level]:", error);
        // Safety net
        return res.status(500).json({ error: "Internal System Error", code: "GENERATION_FAILED" });
    }
};
exports.generateCertificate = generateCertificate;
