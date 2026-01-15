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
    const { messages, context, sessionId } = req.body;
    const userId = (req as any).user?.id;

    console.log("Chat API Request received:", {
      userId,
      hasMessages: !!messages,
      messageCount: messages?.length,
      hasContext: !!context,
    });

    // Check and increment usage for AI Integrity Chat
    await checkUsageLimit("ai_integrity")(req, res, async () => {
      // If we pass the check, increment usage immediately
      await incrementFeatureUsage("ai_integrity")(req, res, () => {});
    });

    // If checkUsageLimit sent a response (error), we shouldn't proceed.
    // However, checkUsageLimit middleware doesn't return a boolean, it calls next() or sends response.
    // Since we are calling it manually without 'next', we need to be careful.
    // Actually, checkUsageLimit as designed (req, res, next) expects to drive flow.
    // Uses 'next' on success.
    // Let's refactor to use it properly as a promise wrapper or middleware.

    // Better approach: Usage check is a Promise<void> but it sends response on failure.
    // If it sends response, res.headersSent might be true (or we can check strict return).
    // Let's use it as strict middleware in the route definition for cleaner code?
    // But we are already inside the handler.

    // Let's try inline manual call pattern that respects the middleware signature:
    let allowed = false;
    await checkUsageLimit("ai_integrity")(req, res, () => {
      allowed = true;
    });
    if (!allowed) return; // Response already sent by middleware

    // Increment usage
    await incrementFeatureUsage("ai_integrity")(req, res, () => {});

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
    const { title } = req.body;

    if (!userId) {
      return sendErrorResponse(res, 401, "Unauthorized");
    }

    const updatedSession = await AIChatService.updateSession(
      sessionId,
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

    await AIChatService.deleteSession(sessionId, userId);
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

    const history = await AIChatService.getSessionHistory(sessionId, userId);
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
