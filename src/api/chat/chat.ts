import express, { Request, Response } from "express";
import { AIChatService } from "../../services/aiChatService";
import {
  checkUsageLimit,
  incrementFeatureUsage,
} from "../../middleware/usageMiddleware";
import { sendJsonResponse, sendErrorResponse } from "../../lib/api-response";

const router = express.Router();

/**
 * POST /api/chat
 * Stream chat response
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { messages, context, sessionId } = req.body as any; // Safe cast until strict model is ready
    const userId = (req as any).user?.id;

    console.log("Chat API Request received:", {
      userId,
      hasMessages: !!messages,
      messageCount: messages?.length,
      hasContext: !!context,
    });

    // Check and consume usage (Atomic Plan/Credit Check)
    const { SubscriptionService } = await import("../../services/subscriptionService");
    const consumption = await SubscriptionService.consumeAction(userId, "ai_integrity");

    if (!consumption.allowed) {
      // Map reason to status code
      let status = 403;
      if (consumption.code === "INSUFFICIENT_CREDITS") {
        status = 402; // Payment required
      }

      return res.status(status).json({
        error: consumption.message || "Usage limit reached",
        code: consumption.code || "PLAN_LIMIT_REACHED",
        data: {
          upgrade_url: "/pricing",
          limit_info: consumption
        }
      });
    }

    const result = await AIChatService.streamChat(
      messages,
      context || { documentContent: "" },
      sessionId,
      userId
    );

    // Forward status and headers
    res.status(result.status);
    result.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Pipe the web stream to express response
    if (result.body) {
      const reader = result.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } catch (err) {
        console.error("Stream error:", err);
        res.end();
      }
    } else {
      res.end();
    }
  } catch (error: any) {
    console.error("Chat API Error:", error);
    // If headers already sent (streaming started), we can't send JSON error
    if (!res.headersSent) {
      sendErrorResponse(res, 500, error.message);
    }
  }
});

/**
 * POST /api/chat/session
 * Create a new chat session
 */
router.post("/session", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { projectId } = req.body;

    if (!userId) {
      return sendErrorResponse(res, 401, "Unauthorized");
    }

    const session = await AIChatService.createSession(userId, projectId);
    return sendJsonResponse(res, 200, session);
  } catch (error: any) {
    return sendErrorResponse(res, 500, error.message);
  }
});

/**
 * GET /api/chat/sessions
 * List all chat sessions for user
 */
router.get("/sessions", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return sendErrorResponse(res, 401, "Unauthorized");
    }

    const sessions = await AIChatService.getUserSessions(userId);
    return sendJsonResponse(res, 200, sessions);
  } catch (error: any) {
    return sendErrorResponse(res, 500, error.message);
  }
});

/**
 * PATCH /api/chat/session/:sessionId
 * Update session (rename)
 */
router.patch("/session/:sessionId", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { sessionId } = req.params;
    const { title } = req.body as { title: string };

    if (!userId) {
      return sendErrorResponse(res, 401, "Unauthorized");
    }

    const updatedSession = await AIChatService.updateSession(
      sessionId as string,
      userId,
      { title }
    );
    return sendJsonResponse(res, 200, updatedSession);
  } catch (error: any) {
    return sendErrorResponse(res, 500, error.message);
  }
});

/**
 * DELETE /api/chat/session/:sessionId
 * Delete session
 */
router.delete("/session/:sessionId", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { sessionId } = req.params;

    if (!userId) {
      return sendErrorResponse(res, 401, "Unauthorized");
    }

    await AIChatService.deleteSession(sessionId as string, userId);
    return sendJsonResponse(res, 200, { success: true });
  } catch (error: any) {
    return sendErrorResponse(res, 500, error.message);
  }
});

/**
 * GET /api/chat/session/:sessionId
 * Get chat history
 */
router.get("/session/:sessionId", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { sessionId } = req.params;

    if (!userId) {
      return sendErrorResponse(res, 401, "Unauthorized");
    }

    const history = await AIChatService.getSessionHistory(sessionId as string, userId);
    return sendJsonResponse(res, 200, history);
  } catch (error: any) {
    return sendErrorResponse(res, 500, error.message);
  }
});

// POST /api/chat/explain-flag
// Explain a specific originality flag
router.post("/explain-flag", async (req: Request, res: Response) => {
  try {
    const { flagType, context } = req.body;
    const explanation = await AIChatService.explainOriginalityFlag(
      flagType,
      context
    );
    return sendJsonResponse(res, 200, explanation);
  } catch (error: any) {
    console.error("Explain Flag API Error:", error);
    return sendErrorResponse(res, 500, error.message);
  }
});

// POST /api/chat/explain-citation
// Explain a citation rule
router.post("/explain-citation", async (req: Request, res: Response) => {
  try {
    const { ruleType, context } = req.body;
    const explanation = await AIChatService.explainCitationRule(
      ruleType,
      context
    );
    return sendJsonResponse(res, 200, explanation);
  } catch (error: any) {
    console.error("Explain Citation API Error:", error);
    return sendErrorResponse(res, 500, error.message);
  }
});

// POST /api/chat/explain-policy
// Explain an academic integrity policy
router.post("/explain-policy", async (req: Request, res: Response) => {
  try {
    const { policyType, context } = req.body;
    const explanation = await AIChatService.explainPolicy(policyType, context);
    return sendJsonResponse(res, 200, explanation);
  } catch (error: any) {
    console.error("Explain Policy API Error:", error);
    return sendErrorResponse(res, 500, error.message);
  }
});

export default router;
