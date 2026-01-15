import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { getSupabaseClient } from "../../lib/supabase/client";
import { EmailService } from "../../services/emailService";
import { SubscriptionService } from "../../services/subscriptionService";
import { RecycleBinService } from "../../services/recycleBinService";
import { SecretsService } from "../../services/secrets-service";

export const getCertificates = async (req: Request, res: Response) => {
  try {
    // Get user from authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify the token with Supabase Auth
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

    const { page = "1", limit = "10", status, certificate_type } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { user_id: user.id };

    if (status) {
      where.status = status;
    }
    if (certificate_type) {
      where.certificate_type = certificate_type;
    }

    const certificates = await prisma.certificate.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { created_at: "desc" },
    });

    const total = await prisma.certificate.count({ where });

    res.json({
      certificates,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });

    return;
  } catch (error) {
    console.error("Error fetching certificates:", error);
    return res.status(500).json({ error: "Failed to fetch certificates" });
  }
};

export const getCertificateById = async (req: Request, res: Response) => {
  try {
    // Get user from authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify the token with Supabase Auth
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

    const { id } = req.params;

    const certificate = await prisma.certificate.findFirst({
      where: { id, user_id: user.id },
    });

    if (!certificate) {
      return res.status(404).json({ error: "Certificate not found" });
    }

    res.json(certificate);
    return;
  } catch (error) {
    console.error("Error fetching certificate:", error);
    return res.status(500).json({ error: "Failed to fetch certificate" });
  }
};

export const createCertificate = async (req: Request, res: Response) => {
  try {
    // Get user from authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify the token with Supabase Auth
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
      project_id,
      title,
      file_name,
      file_path,
      file_size,
      certificate_type,
      metadata,
    } = req.body;

    if (!title || !file_name || !file_path || !file_size) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const certificate = await prisma.certificate.create({
      data: {
        user_id: user.id,
        project_id,
        title,
        file_name,
        file_path,
        file_size,
        status: "completed", // Default to completed since this is for downloaded certificates
        certificate_type: certificate_type || "authorship",
        metadata: metadata || {},
      },
    });

    // Update user metrics
    await prisma.userMetrics.update({
      where: { user_id: user.id },
      data: {
        certificates_downloaded_count: {
          increment: 1,
        },
      },
    });

    // Send certificate ready email
    try {
      if (user.email) {
        // Fetch retention days for the email
        const plan = await SubscriptionService.getActivePlan(user.id);
        const limits = SubscriptionService.getPlanLimits(plan);
        const retentionDays = limits.certificate_retention_days;

        // Fetch prisma user for full name
        const prismaUser = await prisma.user.findUnique({
          where: { id: user.id },
        });

        // Construct certificate URL (assuming it points to the file or a download page)
        // If file_path is a public URL, use it. Otherwise construct dashboard link.
        // Assuming dashboard link is safer/better for context.
        const dashboardUrl = `${await SecretsService.getFrontendUrl()}/certificates`;

        await EmailService.sendCertificateReadyEmail(
          user.email,
          prismaUser?.full_name || "ColabWize User",
          title, // Project name/title
          dashboardUrl,
          retentionDays
        );
      }
    } catch (emailError) {
      console.error("Failed to send certificate ready email:", emailError);
      // Non-blocking
    }

    return res.status(201).json(certificate);
  } catch (error) {
    console.error("Error creating certificate:", error);
    return res.status(500).json({ error: "Failed to create certificate" });
  }
};

export const deleteCertificate = async (req: Request, res: Response) => {
  try {
    // Get user from authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify the token with Supabase Auth
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

    const { id } = req.params;

    const certificate = await prisma.certificate.findFirst({
      where: { id, user_id: user.id },
    });

    if (!certificate) {
      return res.status(404).json({ error: "Certificate not found" });
    }

    // Add to recycle bin logic
    await RecycleBinService.addItemToRecycleBin(user.id, "certificate", {
      id: certificate.id,
      title: certificate.title,
      description: `Certificate: ${certificate.title}`, // Optional description
      file_path: certificate.file_path,
      certificate_type: certificate.certificate_type,
      file_size: certificate.file_size,
      metadata: certificate.metadata,
      created_at: certificate.created_at,
    });

    await prisma.certificate.delete({
      where: { id },
    });

    return res
      .status(200)
      .json({ message: "Certificate deleted successfully" });
  } catch (error) {
    console.error("Error deleting certificate:", error);
    return res.status(500).json({ error: "Failed to delete certificate" });
  }
};

export const updateCertificate = async (req: Request, res: Response) => {
  try {
    // Get user from authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify the token with Supabase Auth
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

    const { id } = req.params;
    const { title, status, metadata } = req.body;

    const certificate = await prisma.certificate.findFirst({
      where: { id, user_id: user.id },
    });

    if (!certificate) {
      return res.status(404).json({ error: "Certificate not found" });
    }

    const updatedCertificate = await prisma.certificate.update({
      where: { id },
      data: {
        title,
        status,
        metadata,
        updated_at: new Date(),
      },
    });

    res.json(updatedCertificate);
    return;
  } catch (error) {
    console.error("Error updating certificate:", error);
    return res.status(500).json({ error: "Failed to update certificate" });
  }
};

// New function to get time to verification data
export const getTimeToVerification = async (req: Request, res: Response) => {
  try {
    // Get user from authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify the token with Supabase Auth
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

    // Get all certificates for the user to calculate verification time
    const certificates = await prisma.certificate.findMany({
      where: {
        user_id: user.id,
      },
      orderBy: {
        created_at: "desc",
      },
      take: 10, // Get the last 10 certificates for trend analysis
    });

    if (certificates.length === 0) {
      return res.json({
        success: true,
        data: {
          avg_verification_time_minutes: 0,
          verification_trend: [],
          previous_avg_verification_time: 0,
        },
      });
    }

    // Calculate average verification time (assuming all certificates are completed)
    // For this implementation, we'll calculate based on the time between creation and now
    // In a real scenario, you might track when verification actually started/ended
    const verificationTimes: number[] = [];

    certificates.forEach((cert: any) => {
      const createdTime = new Date(cert.created_at).getTime();
      const now = new Date().getTime();
      // Calculate time in minutes
      const timeDiffMinutes = Math.round((now - createdTime) / (1000 * 60));
      verificationTimes.push(timeDiffMinutes);
    });

    // Calculate average verification time
    const avgVerificationTime =
      verificationTimes.length > 0
        ? Math.round(
            verificationTimes.reduce((a, b) => a + b, 0) /
              verificationTimes.length
          )
        : 0;

    // Get previous average for comparison (from 2 weeks ago)
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const previousCertificates = await prisma.certificate.findMany({
      where: {
        user_id: user.id,
        created_at: {
          lt: twoWeeksAgo,
        },
      },
    });

    const previousVerificationTimes: number[] = [];
    previousCertificates.forEach((cert: any) => {
      const createdTime = new Date(cert.created_at).getTime();
      const now = new Date().getTime();
      const timeDiffMinutes = Math.round((now - createdTime) / (1000 * 60));
      previousVerificationTimes.push(timeDiffMinutes);
    });

    const previousAvgVerificationTime =
      previousVerificationTimes.length > 0
        ? Math.round(
            previousVerificationTimes.reduce((a, b) => a + b, 0) /
              previousVerificationTimes.length
          )
        : avgVerificationTime;

    // Create trend data for the last 5 certificates
    const trendData = certificates
      .slice(0, 5)
      .map((cert: any, index: number) => {
        const createdTime = new Date(cert.created_at).getTime();
        const now = new Date().getTime();
        const timeDiffMinutes = Math.round((now - createdTime) / (1000 * 60));
        return {
          day: cert.created_at.toLocaleDateString("en-US", {
            weekday: "short",
          }),
          time: timeDiffMinutes,
        };
      })
      .reverse(); // Reverse to show oldest to newest

    res.json({
      success: true,
      data: {
        avg_verification_time_minutes: avgVerificationTime,
        verification_trend: trendData,
        previous_avg_verification_time: previousAvgVerificationTime,
      },
    });
    return;
  } catch (error) {
    console.error("Error getting time to verification:", error);
    return res
      .status(500)
      .json({ error: "Failed to get time to verification data" });
  }
};
// Download certificate
export const downloadCertificate = async (req: Request, res: Response) => {
  try {
    // Get user from authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify the token with Supabase Auth
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

    const { id } = req.params;

    const certificate = await prisma.certificate.findFirst({
      where: { id, user_id: user.id },
    });

    if (!certificate) {
      return res.status(404).json({ error: "Certificate not found" });
    }

    // Import dynamically to avoid circular dependencies if any
    const { SupabaseStorageService } =
      await import("../../services/supabaseStorageService");

    // Get signed URL (valid for 60 seconds)
    const signedUrl = await SupabaseStorageService.createSignedUrl(
      certificate.file_path,
      60
    );

    return res.json({ url: signedUrl });
  } catch (error) {
    console.error("Error downloading certificate:", error);
    return res.status(500).json({ error: "Failed to download certificate" });
  }
};
