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

    // Check Plan Limits
    const plan = await SubscriptionService.getActivePlan(user.id);
    const limits = SubscriptionService.getPlanLimits(plan);

    // Check if user has downloads remaining (if limited)
    // Note: Assuming 'certificate' limit is monthly downloads
    const currentUsage = await SubscriptionService.checkMonthlyUsage(
      user.id,
      "certificate"
    );

    console.log(
      `Certificate usage check: ${currentUsage}/${limits.certificate}`
    );

    // Allow overcoming limit for localhost/dev to avoid getting stuck
    const nodeEnv = await SecretsService.getNodeEnv();
    const isDev = nodeEnv === "development";

    if (
      !isDev &&
      limits.certificate !== -1 &&
      currentUsage >= limits.certificate
    ) {
      console.log("Blocking certificate generation due to limits");
      return res.status(403).json({
        error: "Monthly certificate download limit reached",
        upgrade: true,
      });
    }

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

    // Increment Usage
    await SubscriptionService.incrementUsage(user.id, "certificate");

    // Send PDF buffer directly
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", buffer.length);
    return res.send(buffer);
  } catch (error: any) {
    console.error("Error generating certificate:", error);
    return res
      .status(500)
      .json({ error: error.message || "Failed to generate certificate" });
  }
};
