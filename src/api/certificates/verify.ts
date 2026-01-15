import express, { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { sendJsonResponse, sendErrorResponse } from "../../lib/api-response";
import logger from "../../monitoring/logger";

const router = express.Router();

/**
 * GET /api/certificates/verify/:certificateId
 * Public verification endpoint
 */
router.get("/verify/:certificateId", async (req: Request, res: Response) => {
  try {
    const { certificateId } = req.params;

    if (!certificateId) {
      return sendErrorResponse(res, 400, "Certificate ID is required");
    }

    // Find certificate
    const certificate = await prisma.certificate.findUnique({
      where: { id: certificateId },
      include: {
        user: {
          select: {
            full_name: true,
          },
        },
        project: {
          select: {
            title: true,
            word_count: true,
          },
        },
      },
    });

    if (!certificate) {
      return sendErrorResponse(res, 404, "Certificate not found");
    }

    // Return limited public data
    const publicData = {
      id: certificate.id,
      isValid: true,
      issuedAt: certificate.created_at,
      recipient: certificate.user?.full_name || "ColabWize User",
      projectTitle: certificate.project?.title || "Untitled Project",
      wordCount: certificate.project?.word_count || 0,
      metadata: certificate.metadata,
      status: certificate.status,
    };

    return sendJsonResponse(res, 200, publicData);
  } catch (error: any) {
    logger.error("Error verifying certificate", { error: error.message });
    return sendErrorResponse(res, 500, "Failed to verify certificate");
  }
});

export default router;
