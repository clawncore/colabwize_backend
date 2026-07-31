import { Router } from "express";
import { authenticateExpressRequest } from "../../middleware/auth";
import { CommentService } from "../../services/teamChatService";

const router: Router = Router();

interface AuthRequest {
  user?: { id: string; email?: string };
  [key: string]: any;
}

router.get("/", authenticateExpressRequest, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const { workspaceId, projectId, parentId, limit, offset } = req.query as any;

    const messages = await CommentService.getMessages(
      { workspaceId, projectId, parentId },
      limit ? parseInt(limit) : 50,
      offset ? parseInt(offset) : 0,
    );

    return res.json({ success: true, messages });
  } catch (error: any) {
    console.error("Error fetching messages:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.get("/thread/:parentId", authenticateExpressRequest, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const { parentId } = req.params;
    const messages = await CommentService.getThreadMessages(parentId);

    return res.json({ success: true, messages });
  } catch (error: any) {
    console.error("Error fetching thread:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.post("/", authenticateExpressRequest, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const { content, workspaceId, projectId, parentId } = req.body;

    if (!content) {
      return res.status(400).json({ error: "Content is required" });
    }

    const message = await CommentService.sendMessage(userId, content, {
      workspaceId,
      projectId,
      parentId,
    });

    return res.status(201).json({ success: true, message });
  } catch (error: any) {
    console.error("Error sending message:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.patch("/:id", authenticateExpressRequest, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const { id } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: "Content is required" });
    }

    const updated = await CommentService.updateMessage(id, userId, content);
    return res.json({ success: true, message: updated });
  } catch (error: any) {
    console.error("Error updating message:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.patch("/:id/status", authenticateExpressRequest, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["active", "resolved"].includes(status)) {
      return res.status(400).json({ error: "Status must be 'active' or 'resolved'" });
    }

    const updated = await CommentService.updateMessageStatus(id, userId, status);
    return res.json({ success: true, message: updated });
  } catch (error: any) {
    console.error("Error updating message status:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.delete("/:id", authenticateExpressRequest, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const { id } = req.params;
    const result = await CommentService.deleteMessage(id, userId);
    return res.json(result);
  } catch (error: any) {
    console.error("Error deleting message:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

export default router;
