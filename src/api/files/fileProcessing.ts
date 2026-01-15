import { Router, Request, Response } from "express";
import { authenticateExpressRequest } from "../../middleware/auth";
import logger from "../../monitoring/logger";
import fileProcessing from "../../hybrid/serverless/file-processing";

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

      // Extract the response data
      const responseText = await response.text();
      const responseData = JSON.parse(responseText);

      res.status(response.status).json(responseData);
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
