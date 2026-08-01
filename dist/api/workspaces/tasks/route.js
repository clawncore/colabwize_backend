"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const workspaceTaskService_1 = require("../../../services/workspaceTaskService");
const TaskCommentService_1 = require("../../../services/TaskCommentService");
const TaskAttachmentService_1 = require("../../../services/TaskAttachmentService");
const TaskTimeTrackingService_1 = require("../../../services/TaskTimeTrackingService");
const dependencies_route_1 = __importDefault(require("./dependencies-route"));
const auth_1 = require("../../../middleware/auth");
const multer_1 = __importDefault(require("multer"));
const prisma_1 = __importDefault(require("../../../lib/prisma"));
const role_1 = require("../../../middleware/role");
const upload = (0, multer_1.default)();
const router = (0, express_1.Router)();
// Apply authentication middleware to all routes
router.use(auth_1.authenticateExpressRequest);
// --- Template Routes ---
/**
 * Get all templates for a workspace
 */
router.get("/templates/all", async (req, res) => {
    try {
        const workspaceId = req.query.workspaceId;
        if (!workspaceId) {
            return res.status(400).json({ error: "Workspace ID is required" });
        }
        const templates = await workspaceTaskService_1.WorkspaceTaskService.getTemplates(workspaceId);
        return res.json({ success: true, templates });
    }
    catch (error) {
        console.error("Error fetching templates:", error);
        return res.status(500).json({ error: error.message });
    }
});
/**
 * Save a task as a template
 */
router.post("/templates/save", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { taskId, templateName, category } = req.body;
        if (!taskId || !templateName) {
            return res
                .status(400)
                .json({ error: "Task ID and Template Name are required" });
        }
        const template = await workspaceTaskService_1.WorkspaceTaskService.saveAsTemplate(taskId, templateName, category);
        return res.status(201).json({ success: true, template });
    }
    catch (error) {
        console.error("Error saving as template:", error);
        return res.status(500).json({ error: error.message });
    }
});
/**
 * Create a task from a template
 */
router.post("/from-template", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { templateId, overrides } = req.body;
        const userId = req.user?.id;
        if (!templateId) {
            return res.status(400).json({ error: "Template ID is required" });
        }
        const task = await workspaceTaskService_1.WorkspaceTaskService.createFromTemplate(templateId, userId, overrides);
        return res.status(201).json({ success: true, task });
    }
    catch (error) {
        console.error("Error creating from template:", error);
        return res.status(500).json({ error: error.message });
    }
});
// GET /api/workspaces/tasks - Fetch tasks
router.get("/", async (req, res) => {
    try {
        const workspaceId = req.query.workspaceId;
        const includeTemplates = req.query.includeTemplates === "true";
        if (!workspaceId) {
            return res.status(400).json({ error: "Workspace ID is required" });
        }
        const tasks = await workspaceTaskService_1.WorkspaceTaskService.getTasks(workspaceId, includeTemplates);
        res.status(200).json({ tasks });
    }
    catch (error) {
        console.error("Error in Workspace Task GET:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// --- Comment Routes ---
// GET /api/workspaces/tasks/comments - Fetch comments for a task
router.get("/comments", async (req, res) => {
    try {
        const taskId = req.query.taskId;
        if (!taskId) {
            return res.status(400).json({ error: "Task ID is required" });
        }
        const comments = await TaskCommentService_1.TaskCommentService.getComments(taskId);
        res.status(200).json({ comments });
    }
    catch (error) {
        console.error("Error in Task Comment GET:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// GET /api/workspaces/tasks/time/active - Get user's active timer
router.get("/time/active", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const activeTimer = await TaskTimeTrackingService_1.TaskTimeTrackingService.getActiveTimer(userId);
        res.status(200).json({ activeTimer });
    }
    catch (error) {
        console.error("Error fetching active timer:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// POST /api/workspaces/tasks/:taskId/clone - Clone a task
router.post("/:taskId/clone", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { taskId } = req.params;
        const userId = req.user?.id;
        const clonedTask = await workspaceTaskService_1.WorkspaceTaskService.cloneTask(taskId, userId);
        res.status(201).json({ task: clonedTask });
    }
    catch (error) {
        console.error("Error cloning task:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// GET /api/workspaces/tasks/:taskId - Fetch a single task
router.get("/:taskId", async (req, res) => {
    try {
        const { taskId } = req.params;
        const task = await workspaceTaskService_1.WorkspaceTaskService.getTaskById(taskId);
        if (!task) {
            return res.status(404).json({ error: "Task not found" });
        }
        res.status(200).json({ task });
    }
    catch (error) {
        console.error("Error fetching task:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// POST /api/workspaces/tasks - Create a task
router.post("/", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { workspaceId, ...taskData } = req.body;
        const userId = req.user?.id;
        const task = await workspaceTaskService_1.WorkspaceTaskService.createTask(workspaceId, userId, taskData);
        res.status(201).json({ task });
    }
    catch (error) {
        console.error("Error in Workspace Task POST:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// PATCH /api/workspaces/tasks - Update a task
router.patch("/", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { taskId, ...updateData } = req.body;
        const userId = req.user?.id;
        const task = await workspaceTaskService_1.WorkspaceTaskService.updateTask(taskId, userId, updateData);
        res.status(200).json({ task });
    }
    catch (error) {
        console.error("Error in Workspace Task PATCH:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// PATCH /api/workspaces/tasks/:taskId/custom-fields - Update task custom field values
router.patch("/:taskId/custom-fields", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { taskId } = req.params;
        const { values } = req.body; // Record<field_id, value>
        if (!taskId || !values) {
            return res
                .status(400)
                .json({ error: "Task ID and values are required" });
        }
        const task = await workspaceTaskService_1.WorkspaceTaskService.updateTaskCustomFields(taskId, values);
        res.status(200).json({ task });
    }
    catch (error) {
        console.error("Error updating task custom fields:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// DELETE /api/workspaces/tasks - Delete a task
router.delete("/", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const taskId = req.query.id;
        if (!taskId) {
            return res.status(400).json({ error: "Task ID is required" });
        }
        await workspaceTaskService_1.WorkspaceTaskService.deleteTask(taskId, req.user.id);
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error("Error in Workspace Task DELETE:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// --- Bulk Operations ---
// PATCH /api/workspaces/tasks/bulk - Bulk update tasks
router.patch("/bulk", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { workspaceId, taskIds, ...updateData } = req.body;
        const userId = req.user?.id;
        const tasks = await workspaceTaskService_1.WorkspaceTaskService.bulkUpdateTasks(workspaceId, userId, taskIds, updateData);
        res.status(200).json({ tasks });
    }
    catch (error) {
        console.error("Error in Workspace Task Bulk PATCH:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// DELETE /api/workspaces/tasks/bulk - Bulk delete tasks
router.delete("/bulk", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const workspaceId = req.query.workspaceId;
        const taskIds = JSON.parse(req.query.taskIds);
        const userId = req.user?.id;
        await workspaceTaskService_1.WorkspaceTaskService.bulkDeleteTasks(workspaceId, taskIds, userId);
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error("Error in Workspace Task Bulk DELETE:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// --- Comment Routes ---
// POST /api/workspaces/tasks/comments - Add a comment
router.post("/comments", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { taskId, content } = req.body;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        if (!taskId || !content) {
            return res
                .status(400)
                .json({ error: "Task ID and content are required" });
        }
        const comment = await TaskCommentService_1.TaskCommentService.addComment(taskId, userId, content);
        res.status(201).json({ comment });
    }
    catch (error) {
        console.error("Error in Task Comment POST:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// DELETE /api/workspaces/tasks/comments/:id - Delete a comment
router.delete("/comments/:id", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const commentId = req.params.id;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        await TaskCommentService_1.TaskCommentService.deleteComment(commentId, userId);
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error("Error in Task Comment DELETE:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// --- Attachment Routes ---
// POST /api/workspaces/tasks/:taskId/attachments - Upload an attachment
router.post("/:taskId/attachments", (0, role_1.checkWorkspaceRole)("editor"), upload.single("file"), async (req, res) => {
    try {
        const { taskId } = req.params;
        const file = req.file;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        if (!file) {
            return res.status(400).json({ error: "No file uploaded" });
        }
        // --- Subscription Limits Check ---
        const userSubscription = await prisma_1.default.subscription.findUnique({
            where: { user_id: userId },
        });
        const plan = userSubscription?.plan?.toLowerCase() || "free";
        // Get workspaceId for this task to count total attachments in workspace
        const task = await prisma_1.default.workspaceTask.findUnique({
            where: { id: taskId },
            select: { workspace_id: true },
        });
        if (!task) {
            return res.status(404).json({ error: "Task not found" });
        }
        const workspaceId = task.workspace_id;
        // Check document count limit (Total in workspace)
        const attachmentCount = await prisma_1.default.taskAttachment.count({
            where: {
                task: {
                    workspace_id: workspaceId,
                },
            },
        });
        let countLimit = Infinity;
        let sizeLimitMB = 100;
        if (plan === "free") {
            countLimit = 5;
            sizeLimitMB = 5;
        }
        else if (plan === "plus") {
            countLimit = 50;
            sizeLimitMB = 50;
        }
        else if (plan === "premium") {
            countLimit = Infinity;
            sizeLimitMB = 100;
        }
        const sizeLimitBytes = sizeLimitMB * 1024 * 1024;
        if (attachmentCount >= countLimit) {
            return res.status(403).json({
                error: "ATTACHMENT_LIMIT_REACHED",
                message: `You have reached the limit of ${countLimit} attachments for your ${plan} plan.`,
                limit: countLimit,
            });
        }
        if (file.size > sizeLimitBytes) {
            return res.status(403).json({
                error: "FILE_SIZE_EXCEEDED",
                message: `File size exceeds the ${sizeLimitMB}MB limit for your ${plan} plan.`,
                limit: sizeLimitMB,
            });
        }
        // --- End Subscription Limits Check ---
        const attachment = await TaskAttachmentService_1.TaskAttachmentService.uploadAttachment(taskId, userId, file.buffer, file.originalname, file.mimetype);
        res.status(201).json({ attachment });
    }
    catch (error) {
        console.error("Error in Task Attachment POST:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// DELETE /api/workspaces/tasks/attachments/:id - Delete an attachment
router.delete("/attachments/:id", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const attachmentId = req.params.id;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        await TaskAttachmentService_1.TaskAttachmentService.deleteAttachment(attachmentId);
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error("Error in Task Attachment DELETE:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// GET /api/workspaces/tasks/attachments/:id/stream - Stream attachment content
router.get("/attachments/:id/stream", async (req, res) => {
    try {
        const attachmentId = req.params.id;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const attachment = await TaskAttachmentService_1.TaskAttachmentService.getAttachmentById(attachmentId);
        if (!attachment) {
            return res.status(404).json({ error: "Attachment not found" });
        }
        // If file_url is already a full external URL (Supabase public URL), redirect to it
        const fileUrl = attachment.file_url;
        if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
            // Stream through to avoid CORS issues
            const https = fileUrl.startsWith("https")
                ? require("https")
                : require("http");
            return https.get(fileUrl, (fileRes) => {
                res.setHeader("Content-Type", attachment.file_type || "application/octet-stream");
                res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.name)}"`);
                res.setHeader("Cache-Control", "private, max-age=3600");
                fileRes.pipe(res);
            });
        }
        // Otherwise download from Supabase storage using the service
        const { data, mimeType } = await TaskAttachmentService_1.TaskAttachmentService.downloadAttachment(attachmentId);
        res.setHeader("Content-Type", mimeType || "application/octet-stream");
        res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.name)}"`);
        res.setHeader("Cache-Control", "private, max-age=3600");
        res.send(data);
    }
    catch (error) {
        console.error("Error in Task Attachment Stream GET:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// GET /api/workspaces/tasks/attachments/:id/download - Download attachment
router.get("/attachments/:id/download", async (req, res) => {
    try {
        const attachmentId = req.params.id;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const attachment = await TaskAttachmentService_1.TaskAttachmentService.getAttachmentById(attachmentId);
        if (!attachment) {
            return res.status(404).json({ error: "Attachment not found" });
        }
        const { data, mimeType } = await TaskAttachmentService_1.TaskAttachmentService.downloadAttachment(attachmentId);
        res.setHeader("Content-Type", mimeType || "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(attachment.name)}"`);
        res.setHeader("Cache-Control", "private, max-age=3600");
        res.send(data);
    }
    catch (error) {
        console.error("Error in Task Attachment Download GET:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// GET /api/workspaces/tasks/attachments/:id/annotations - Get saved annotations
router.get("/attachments/:id/annotations", async (req, res) => {
    try {
        const attachmentId = req.params.id;
        const attachment = await TaskAttachmentService_1.TaskAttachmentService.getAttachmentById(attachmentId);
        if (!attachment)
            return res.status(404).json({ error: "Attachment not found" });
        res.json({ annotations: attachment.annotations || [] });
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// PUT /api/workspaces/tasks/attachments/:id/annotations - Save annotations
router.put("/attachments/:id/annotations", async (req, res) => {
    try {
        const attachmentId = req.params.id;
        const { annotations } = req.body;
        if (!Array.isArray(annotations)) {
            return res.status(400).json({ error: "annotations must be an array" });
        }
        const { prisma } = require("../../../lib/prisma");
        const updated = await prisma.taskAttachment.update({
            where: { id: attachmentId },
            data: { annotations },
        });
        res.json({ annotations: updated.annotations });
    }
    catch (error) {
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// --- Recurring Task Routes ---
// GET /api/workspaces/tasks/:taskId/upcoming-instances - Get upcoming instances of a recurring task
router.get("/:taskId/upcoming-instances", async (req, res) => {
    try {
        const { taskId } = req.params;
        const count = parseInt(req.query.count) || 10;
        if (!taskId) {
            return res.status(400).json({ error: "Task ID is required" });
        }
        const task = await prisma_1.default.workspaceTask.findUnique({
            where: { id: taskId },
        });
        if (!task ||
            !task.is_recurring ||
            !task.recurrence_pattern ||
            !task.due_date) {
            return res.status(400).json({ error: "Task is not a recurring task" });
        }
        const RecurringTaskService = require("../../../services/RecurringTaskService").default;
        const occurrences = RecurringTaskService.getNextOccurrences(task.recurrence_pattern, task.due_date, count);
        res.status(200).json({ occurrences });
    }
    catch (error) {
        console.error("Error fetching upcoming instances:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// POST /api/workspaces/tasks/:taskId/skip-occurrence - Skip a specific occurrence
router.post("/:taskId/skip-occurrence", async (req, res) => {
    try {
        const { taskId } = req.params;
        const { occurrenceDate } = req.body;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        if (!occurrenceDate) {
            return res.status(400).json({ error: "Occurrence date is required" });
        }
        // Create an exception instance with skipped status
        const skippedInstance = await prisma_1.default.workspaceTask.create({
            data: {
                workspace_id: req.body.workspaceId,
                creator_id: userId,
                title: "Skipped",
                status: "done", // Mark as done so it won't show in active tasks
                due_date: new Date(occurrenceDate),
                parent_recurring_task_id: taskId,
                is_recurrence_exception: true,
                original_due_date: new Date(occurrenceDate),
            },
        });
        res.status(201).json({ success: true, instance: skippedInstance });
    }
    catch (error) {
        console.error("Error skipping occurrence:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// POST /api/workspaces/tasks/:taskId/generate-instances - Manually trigger instance generation
router.post("/:taskId/generate-instances", async (req, res) => {
    try {
        const { taskId } = req.params;
        const weeksAhead = parseInt(req.body.weeksAhead) || 2;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const RecurringTaskService = require("../../../services/RecurringTaskService").default;
        const instances = await RecurringTaskService.generateTaskInstances(taskId, weeksAhead);
        res
            .status(201)
            .json({ success: true, instancesCreated: instances.length, instances });
    }
    catch (error) {
        console.error("Error generating instances:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// GET /api/workspaces/tasks/by-project/:projectId - Get tasks for a specific project
router.get("/by-project/:projectId", async (req, res) => {
    try {
        const { projectId } = req.params;
        if (!projectId) {
            return res.status(400).json({ error: "Project ID is required" });
        }
        const tasks = await workspaceTaskService_1.WorkspaceTaskService.getTasksByProject(projectId);
        res.status(200).json({ tasks });
    }
    catch (error) {
        console.error("Error fetching tasks by project:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// GET /api/workspaces/tasks/project-stats/:projectId - Get task statistics for a project
router.get("/project-stats/:projectId", async (req, res) => {
    try {
        const { projectId } = req.params;
        if (!projectId) {
            return res.status(400).json({ error: "Project ID is required" });
        }
        const stats = await workspaceTaskService_1.WorkspaceTaskService.getProjectTaskStats(projectId);
        res.status(200).json(stats);
    }
    catch (error) {
        console.error("Error fetching project task stats:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// --- Dependency Routes ---
router.use("/:taskId/dependencies", (0, role_1.checkWorkspaceRole)("editor"), dependencies_route_1.default);
// ============ TIME TRACKING ENDPOINTS ============
// POST /api/workspaces/tasks/:taskId/time/start - Start a timer
router.post("/:taskId/time/start", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { taskId } = req.params;
        const { description } = req.body;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const entry = await TaskTimeTrackingService_1.TaskTimeTrackingService.startTimer(taskId, userId, description);
        res.status(200).json(entry);
    }
    catch (error) {
        console.error("Error starting timer:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// POST /api/workspaces/tasks/time/stop - Stop active timer
router.post("/time/stop/:entryId", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { entryId } = req.params;
        const entry = await TaskTimeTrackingService_1.TaskTimeTrackingService.stopTimer(entryId);
        res.status(200).json(entry);
    }
    catch (error) {
        console.error("Error stopping timer:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// POST /api/workspaces/tasks/:taskId/time/log - Log manual time entry
router.post("/:taskId/time/log", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { taskId } = req.params;
        const { start_time, end_time, duration, description } = req.body;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const entry = await TaskTimeTrackingService_1.TaskTimeTrackingService.logTime(taskId, userId, {
            start_time: new Date(start_time),
            end_time: end_time ? new Date(end_time) : undefined,
            duration,
            description,
        });
        res.status(200).json(entry);
    }
    catch (error) {
        console.error("Error logging time:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// GET /api/workspaces/tasks/:taskId/time - Get time entries for a task
router.get("/:taskId/time", async (req, res) => {
    try {
        const { taskId } = req.params;
        const entries = await TaskTimeTrackingService_1.TaskTimeTrackingService.getTaskTimeEntries(taskId);
        res.status(200).json({ entries });
    }
    catch (error) {
        console.error("Error fetching time entries:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// GET /api/workspaces/tasks/:taskId/time/total - Get total time spent on task
router.get("/:taskId/time/total", async (req, res) => {
    try {
        const { taskId } = req.params;
        const totals = await TaskTimeTrackingService_1.TaskTimeTrackingService.getTotalTimeSpent(taskId);
        res.status(200).json(totals);
    }
    catch (error) {
        console.error("Error calculating total time:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// DELETE /api/workspaces/tasks/time/:entryId - Delete a time entry
router.delete("/time/:entryId", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { entryId } = req.params;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        await TaskTimeTrackingService_1.TaskTimeTrackingService.deleteTimeEntry(entryId, userId);
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error("Error deleting time entry:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// PATCH /api/workspaces/tasks/time/:entryId - Update a time entry
router.patch("/time/:entryId", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { entryId } = req.params;
        const { start_time, end_time, duration, description } = req.body;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const entry = await TaskTimeTrackingService_1.TaskTimeTrackingService.updateTimeEntry(entryId, userId, {
            start_time: start_time ? new Date(start_time) : undefined,
            end_time: end_time ? new Date(end_time) : undefined,
            duration,
            description,
        });
        res.status(200).json(entry);
    }
    catch (error) {
        console.error("Error updating time entry:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
exports.default = router;
