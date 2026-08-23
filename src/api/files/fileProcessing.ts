import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticateExpressRequest } from "../../middleware/auth";
import logger from "../../monitoring/logger";
import fileProcessing from "../../hybrid/serverless/file-processing";

// Payload contract for import/export operations. htmlContent is required only
// for export-* types; it's validated per-request below.
const filePayloadSchema = z.object({
  fileType: z.enum(["document-import", "export-pdf", "export-docx"]),
  fileData: z
    .object({
      id: z.string().optional(),
      projectId: z.string().optional(),
      title: z.string().max(500).optional(),
      content: z.unknown().optional(),
      htmlContent: z.string().max(20 * 1024 * 1024).optional(),
      citationStyle: z.string().optional(),
      wordCount: z.number().nonnegative().optional(),
      type: z.string().optional(),
      metadata: z
        .object({
          author: z.string().max(300).optional(),
          institution: z.string().max(300).optional(),
          course: z.string().max(120).optional(),
          instructor: z.string().max(120).optional(),
          runningHead: z.string().max(120).optional(),
          date: z.string().max(60).optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough(),
});

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    full_name?: string;
  };
}

const router = Router();

// Process file (import/export operations)
router.post(
  "/",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = filePayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error:
            "Invalid file processing payload: " +
            parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        });
      }

      // Exports carry their HTML inline; reject early when missing.
      if (
        parsed.data.fileType.startsWith("export-") &&
        !parsed.data.fileData.htmlContent
      ) {
        return res.status(400).json({
          success: false,
          error: "Missing HTML content for direct export path",
        });
      }
      // Create a mock request object that matches the expected interface in file-processing.ts
      const mockRequest = {
        json: async () => ({
          fileData: req.body.fileData,
          fileType: req.body.fileType,
          userId: req.user!.id,
        }),
      };

      // Call the serverless function
      const response = await fileProcessing(mockRequest as any);

      // Handle different response types based on headers
      const contentType = response.headers.get("Content-Type") || "";

      if (contentType.includes("application/json")) {
        const responseData = await response.json();
        res.status(response.status).json(responseData);
      } else {
        // Pass headers forward (like Content-Disposition for attachments)
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        // Send binary buffer directly
        const arrayBuffer = await response.arrayBuffer();
        res.status(response.status).end(Buffer.from(arrayBuffer));
      }
    } catch (error: any) {
      logger.error("File processing API error", {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: error.message || "Internal server error",
      });
    }
  }
);

export default router;
