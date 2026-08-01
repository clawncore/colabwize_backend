"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const aiChatService_1 = require("../../services/aiChatService");
const api_response_1 = require("../../lib/api-response");
const router = express_1.default.Router();
/**
 * POST /api/chat
 * Stream chat response
 */
router.post("/", async (req, res) => {
    try {
        const { messages, context, sessionId } = req.body;
        const userId = req.user?.id;
        console.log("Chat API Request received:", {
            userId,
            hasMessages: !!messages,
            messageCount: messages?.length,
            hasContext: !!context,
        });
        // Usage enforcement is handled inside AIChatService.streamChat using the correct
        // 'ai_chat' feature key. Do NOT add a redundant check here.
        const result = await aiChatService_1.AIChatService.streamChat(messages, context || { documentContent: "" }, sessionId, userId);
        // Forward status and headers
        res.status(result.status);
        result.headers.forEach((value, key) => {
            res.setHeader(key, value);
        });
        // If the service returned a non-2xx (e.g. 403 limit reached), pipe the JSON body
        if (result.status >= 400) {
            const body = await result.text();
            return res.end(body);
        }
        // Pipe the web stream to express response
        if (result.body) {
            const reader = result.body.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    res.write(value);
                }
                res.end();
            }
            catch (err) {
                console.error("Stream error:", err);
                res.end();
            }
        }
        else {
            res.end();
        }
    }
    catch (error) {
        console.error("Chat API Error:", error);
        // If headers already sent (streaming started), we can't send JSON error
        if (!res.headersSent) {
            (0, api_response_1.sendErrorResponse)(res, 500, error.message);
        }
    }
});
/**
 * POST /api/chat/session
 * Create a new chat session
 */
router.post("/session", async (req, res) => {
    try {
        const userId = req.user?.id;
        const { projectId, fileId, externalPaperId } = req.body;
        if (!userId) {
            return (0, api_response_1.sendErrorResponse)(res, 401, "Unauthorized");
        }
        const session = await aiChatService_1.AIChatService.createSession(userId, projectId, fileId, externalPaperId);
        return (0, api_response_1.sendJsonResponse)(res, 200, session);
    }
    catch (error) {
        return (0, api_response_1.sendErrorResponse)(res, 500, error.message);
    }
});
/**
 * GET /api/chat/sessions
 * List all chat sessions for user
 */
router.get("/sessions", async (req, res) => {
    try {
        const userId = req.user?.id;
        const { projectId, fileId, externalPaperId } = req.query;
        if (!userId) {
            return (0, api_response_1.sendErrorResponse)(res, 401, "Unauthorized");
        }
        const sessions = await aiChatService_1.AIChatService.getUserSessions(userId, {
            projectId: projectId,
            fileId: fileId,
            externalPaperId: externalPaperId,
        });
        return (0, api_response_1.sendJsonResponse)(res, 200, sessions);
    }
    catch (error) {
        return (0, api_response_1.sendErrorResponse)(res, 500, error.message);
    }
});
/**
 * PATCH /api/chat/session/:sessionId
 * Update session (rename)
 */
router.patch("/session/:sessionId", async (req, res) => {
    try {
        const userId = req.user?.id;
        const { sessionId } = req.params;
        const { title } = req.body;
        if (!userId) {
            return (0, api_response_1.sendErrorResponse)(res, 401, "Unauthorized");
        }
        const updatedSession = await aiChatService_1.AIChatService.updateSession(sessionId, userId, { title });
        return (0, api_response_1.sendJsonResponse)(res, 200, updatedSession);
    }
    catch (error) {
        return (0, api_response_1.sendErrorResponse)(res, 500, error.message);
    }
});
/**
 * DELETE /api/chat/session/:sessionId
 * Delete session
 */
router.delete("/session/:sessionId", async (req, res) => {
    try {
        const userId = req.user?.id;
        const { sessionId } = req.params;
        if (!userId) {
            return (0, api_response_1.sendErrorResponse)(res, 401, "Unauthorized");
        }
        await aiChatService_1.AIChatService.deleteSession(sessionId, userId);
        return (0, api_response_1.sendJsonResponse)(res, 200, { success: true });
    }
    catch (error) {
        return (0, api_response_1.sendErrorResponse)(res, 500, error.message);
    }
});
/**
 * GET /api/chat/session/:sessionId
 * Get chat history
 */
router.get("/session/:sessionId", async (req, res) => {
    try {
        const userId = req.user?.id;
        const { sessionId } = req.params;
        if (!userId) {
            return (0, api_response_1.sendErrorResponse)(res, 401, "Unauthorized");
        }
        const history = await aiChatService_1.AIChatService.getSessionHistory(sessionId, userId);
        return (0, api_response_1.sendJsonResponse)(res, 200, history);
    }
    catch (error) {
        return (0, api_response_1.sendErrorResponse)(res, 500, error.message);
    }
});
// POST /api/chat/explain-flag
// Explain a specific originality flag
router.post("/explain-flag", async (req, res) => {
    try {
        const { flagType, context } = req.body;
        const explanation = await aiChatService_1.AIChatService.explainOriginalityFlag(flagType, context);
        return (0, api_response_1.sendJsonResponse)(res, 200, explanation);
    }
    catch (error) {
        console.error("Explain Flag API Error:", error);
        return (0, api_response_1.sendErrorResponse)(res, 500, error.message);
    }
});
// POST /api/chat/explain-citation
// Explain a citation rule
router.post("/explain-citation", async (req, res) => {
    try {
        const { ruleType, context } = req.body;
        const explanation = await aiChatService_1.AIChatService.explainCitationRule(ruleType, context);
        return (0, api_response_1.sendJsonResponse)(res, 200, explanation);
    }
    catch (error) {
        console.error("Explain Citation API Error:", error);
        return (0, api_response_1.sendErrorResponse)(res, 500, error.message);
    }
});
// POST /api/chat/explain-policy
// Explain an academic integrity policy
router.post("/explain-policy", async (req, res) => {
    try {
        const { policyType, context } = req.body;
        const explanation = await aiChatService_1.AIChatService.explainPolicy(policyType, context);
        return (0, api_response_1.sendJsonResponse)(res, 200, explanation);
    }
    catch (error) {
        console.error("Explain Policy API Error:", error);
        return (0, api_response_1.sendErrorResponse)(res, 500, error.message);
    }
});
exports.default = router;
