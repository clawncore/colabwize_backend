import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { getSupabaseClient } from "../../lib/supabase/client";
import { AuthorshipCertificateGenerator } from "../../services/authorshipCertificateGenerator";
import { SubscriptionService } from "../../services/subscriptionService";
import { randomUUID } from "crypto";
import { SecretsService } from "../../services/secrets-service";

export const generateCertificate = async (req: Request, res: Response) => {
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
      const client = await getSupabaseClient();
      if (!client) {
        return res
          .status(500)
          .json({ error: "Supabase client not initialized" });
      }
      const {
        data: { user: userData },
        error,
      } = await client.auth.getUser(token);
      if (error || !userData) {
        return res.status(401).json({ error: "Invalid or expired token" });
      }
      user = userData;
    } catch (error) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const {
      projectId,
      certificateType = "authorship",
      includeQRCode = true,
    } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: "Project ID is required" });
    }

    // Get Project and User details
    const project = await prisma.project.findUnique({
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

    const prismaUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!prismaUser) {
      return res.status(404).json({ error: "User profile not found" });
    }

    // Check Plan Limits (Atomic Pre-flight)
    const eligibility = await SubscriptionService.checkActionEligibility(user.id, "certificate");

    if (!eligibility.allowed) {
      console.log("Blocking certificate generation:", eligibility.message);
      // Map reason to status code
      let status = 403;
      if (eligibility.code === "INSUFFICIENT_CREDITS") {
        status = 402; // Payment required/insufficient funds
      }
      return res.status(status).json({
        error: eligibility.message || "Monthly limit reached",
        code: eligibility.code || "PLAN_LIMIT_REACHED",
        data: { upgrade_url: "/pricing", limit_info: eligibility }
      });
    }

    // Fetch plan details for metadata and watermark logic
    const plan = await SubscriptionService.getActivePlan(user.id);
    const limits = SubscriptionService.getPlanLimits(plan);

    // WRAP EVERYTHING in try/catch for timeout mapping
    try {
      // Generate Certificate HTML (reuse for both PDF and preview)
      const stats = await import("../../services/authorshipReportService").then(
        (m) =>
          m.AuthorshipReportService.generateAuthorshipReport(projectId, user.id)
      );
      const frontendUrl = await SecretsService.getFrontendUrl();
      const qrCodeDataUrl = includeQRCode
        ? await import("qrcode").then((qr) =>
          qr.default.toDataURL(`${frontendUrl}/verify/${projectId}`, {
            errorCorrectionLevel: "H",
            margin: 1,
            width: 200,
            color: { dark: "#000000", light: "#FFFFFF" },
          })
        )
        : null;

      // Generate HTML first
      const html = await AuthorshipCertificateGenerator.generateCertificateHTML(
        {
          projectId,
          userId: user.id,
          userName: prismaUser.full_name || "ColabWize User",
          projectTitle: project.title || "Untitled Project",
          certificateType,
          includeQRCode,
          verificationUrl: `${frontendUrl}/verify/${projectId}`,
          watermark: limits.watermark,
        },
        stats,
        qrCodeDataUrl
      );

      // Generate PDF from HTML
      const buffer = await AuthorshipCertificateGenerator.convertHTMLToPDF(html);

      // Generate preview image from same HTML
      const previewBuffer =
        await AuthorshipCertificateGenerator.generatePreviewImage(html);

      // Upload PDF to Supabase
      const fileName = `certificate-${projectId}-${randomUUID()}.pdf`;
      const { path: pdfPath } =
        await import("../../services/supabaseStorageService").then((m) =>
          m.SupabaseStorageService.uploadFile(
            buffer,
            fileName,
            "application/pdf",
            user.id,
            {
              userId: user.id,
              fileName: fileName,
              fileType: "application/pdf",
              fileSize: buffer.length,
              projectId: projectId,
              createdAt: new Date(),
            }
          )
        );

      // Upload Preview Image to Supabase
      const previewFileName = `preview-${projectId}-${randomUUID()}.png`;
      const { publicUrl: previewPublicUrl } =
        await import("../../services/supabaseStorageService").then((m) =>
          m.SupabaseStorageService.uploadFile(
            previewBuffer,
            previewFileName,
            "image/png",
            user.id,
            {
              userId: user.id,
              fileName: previewFileName,
              fileType: "image/png",
              fileSize: previewBuffer.length,
              projectId: projectId,
              createdAt: new Date(),
            }
          )
        );

      // Create Certificate Record with preview URL
      await prisma.certificate.create({
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
          },
        },
      });

      // Increment Usage / Deduct Credits
      const consumption = await SubscriptionService.consumeAction(user.id, "certificate");
      if (!consumption.allowed) {
        // This shouldn't happen if pre-check passed, but could in race conditions.
        // Log it, but don't fail the user request since they got the file.
        console.error("CRITICAL: Deduct failed after generation", { userId: user.id });
      }

      // Send PDF buffer directly
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Content-Length", buffer.length);
      return res.send(buffer);

    } catch (innerError: any) {
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

      // Genuine System Failure
      return res.status(500).json({
        error: "We couldn't complete this request due to a system issue.",
        code: "GENERATION_FAILED"
      });
    }

  } catch (error: any) {
    console.error("Error generating certificate [Top Level]:", error);
    // Safety net
    return res.status(500).json({ error: "Internal System Error", code: "GENERATION_FAILED" });
  }
};
