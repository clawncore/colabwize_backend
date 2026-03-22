import { Router } from "express";
import { SubtaskService } from "../../../../services/SubtaskService";
import { authenticateExpressRequest } from "../../../../middleware/auth";
import { checkWorkspaceRole } from "../../../../middleware/role";

const router = Router();

// GET /api/workspaces/tasks/subtasks?taskId=... - Get subtasks for a task
router.get("/", authenticateExpressRequest, async (req: any, res) => {
  try {
    const taskId = req.query.taskId as string;
    if (!taskId) return res.status(400).json({ error: "Task ID is required" });

    const subtasks = await SubtaskService.getSubtasks(taskId);
    res.json({ subtasks });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/workspaces/tasks/subtasks - Create a subtask
router.post("/", authenticateExpressRequest, checkWorkspaceRole("editor"), async (req: any, res) => {
  try {
    const { taskId, title } = req.body;
    if (!taskId || !title)
      return res.status(400).json({ error: "Task ID and title are required" });

    const subtask = await SubtaskService.createSubtask(taskId, title);
    res.status(201).json({ subtask });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/workspaces/tasks/subtasks/:subtaskId - Update a subtask
router.patch("/:subtaskId", authenticateExpressRequest, checkWorkspaceRole("editor"), async (req: any, res) => {
  try {
    const { subtaskId } = req.params;
    const { title, is_done, order } = req.body;

    const subtask = await SubtaskService.updateSubtask(subtaskId, {
      title,
      is_done,
      order,
    });
    res.json({ subtask });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/workspaces/tasks/subtasks/:subtaskId - Delete a subtask
router.delete("/:subtaskId", authenticateExpressRequest, checkWorkspaceRole("editor"), async (req: any, res) => {
  try {
    const { subtaskId } = req.params;
    await SubtaskService.deleteSubtask(subtaskId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
