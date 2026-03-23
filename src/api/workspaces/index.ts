import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { authenticateExpressRequest } from "../../middleware/auth";
import logger from "../../monitoring/logger";
import tasksRouter from "./tasks/route";
import subtasksRouter from "./tasks/subtasks/route";
import labelsRouter from "./labels-route";
import viewsRouter from "./views-route";
import customFieldsRouter from "./custom-fields-route";
import activityRouter from "./activity";
import { WorkspaceActivityService } from "../../services/workspaceActivityService";
import { broadcastGenericNotification } from "../../services/notificationService";

const router = Router();

// Middleware to ensure user is authenticated
router.use(authenticateExpressRequest);

const { checkWorkspaceRole } = require("../../middleware/role");

// Sub-routers
router.use("/", activityRouter); // Handles /:id/activity
router.use("/:workspaceId/custom-fields", customFieldsRouter);
router.use("/", labelsRouter);
router.use("/tasks/subtasks", subtasksRouter);
router.use("/tasks", tasksRouter);
router.use("/:workspaceId/views", viewsRouter);

// GET /api/workspaces/:id/analytics - Get workspace analytics with project metrics
router.get(
  "/:id/analytics",
  checkWorkspaceRole("editor"),
  async (req: any, res) => {
    try {
      const { id } = req.params;
      const {
        WorkspaceAnalyticsService,
      } = require("../../services/WorkspaceAnalyticsService");
      const analytics =
        await WorkspaceAnalyticsService.getWorkspaceAnalyticsWithProjects(id);
      res.json(analytics);
    } catch (error) {
      logger.error("Error fetching workspace analytics", error);
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  },
);

// GET /api/workspaces/:id/members - Get only members for selection
router.get("/:id/members", async (req: any, res) => {
  try {
    const { id } = req.params;
    const members = await prisma.workspaceMember.findMany({
      where: { workspace_id: id },
      include: {
        user: {
          select: { id: true, full_name: true, email: true },
        },
      },
    });
    res.json(members.map((m: any) => m.user));
  } catch (error) {
    logger.error("Error fetching workspace members", error);
    res.status(500).json({ error: "Failed to fetch members" });
  }
});

// GET /api/workspaces/:id/files - Get all files (attachments) for a workspace
router.get("/:id/files", async (req: any, res) => {
  try {
    const { id } = req.params;
    const files = await prisma.taskAttachment.findMany({
      where: {
        task: {
          workspace_id: id,
        },
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            project_id: true,
            project: {
              select: { title: true },
            },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });
    res.json(files);
  } catch (error) {
    logger.error("Error fetching workspace files", error);
    res.status(500).json({ error: "Failed to fetch files" });
  }
});

// GET /api/workspaces/:id/overview - Get aggregated overview data for a workspace
router.get("/:id/overview", async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const {
      WorkspaceActivityService,
    } = require("../../services/workspaceActivityService");

    // Fetch all data in parallel
    const [
      activeProjectsCount,
      completedProjectsCount,
      tasksCounts,
      myTasks,
      recentActivity,
      membersCount,
      recentProjects,
    ] = await Promise.all([
      // 1. Projects Counts
      prisma.project.count({
        where: { workspace_id: id, status: "active" },
      }),
      prisma.project.count({
        where: { workspace_id: id, status: "completed" },
      }),

      // 2. Tasks Counts (Grouped by status)
      prisma.workspaceTask.groupBy({
        by: ["status"],
        where: {
          workspace_id: id,
          is_template: false,
          OR: [
            { is_recurring: false },
            { parent_recurring_task_id: { not: null } }
          ]
        },
        _count: {
          status: true,
        },
      }),

      // 3. My Tasks (Due soon)
      prisma.workspaceTask.findMany({
        where: {
          workspace_id: id,
          assignees: { some: { user_id: userId } },
          status: { not: "done" },
          is_template: false,
          OR: [
            { is_recurring: false },
            { parent_recurring_task_id: { not: null } }
          ]
        },
        orderBy: [
          { due_date: "asc" },
          { created_at: "desc" }
        ],
        take: 10,
        include: {
          project: { select: { title: true } },
          assignees: {
            include: {
              user: { select: { id: true, full_name: true, avatar_url: true } },
            },
          },
        },
      }),

      // 4. Recent Activity
      WorkspaceActivityService.getActivities(id, 10),

      // 5. Members Count
      prisma.workspaceMember.count({
        where: { workspace_id: id },
      }),

      // 6. Recent Projects
      prisma.project.findMany({
        where: { workspace_id: id },
        orderBy: { updated_at: "desc" },
        take: 4,
        include: {
          _count: {
            select: { tasks: true },
          },
          collaborators: {
            take: 3,
            include: {
              user: {
                select: { id: true, full_name: true, avatar_url: true },
              },
            },
          },
        },
      }),
    ]);

    // Process tasks counts into a cleaner format
    const taskStats = {
      todo: 0,
      in_progress: 0,
      done: 0,
      total: 0,
    };

    tasksCounts.forEach((group: any) => {
      taskStats.total += group._count.status;
      if (group.status === "todo") taskStats.todo = group._count.status;
      else if (group.status === "in-progress")
        taskStats.in_progress = group._count.status;
      else if (group.status === "done") taskStats.done = group._count.status;
    });

    res.json({
      stats: {
        projects: {
          active: activeProjectsCount,
          completed: completedProjectsCount,
          total: activeProjectsCount + completedProjectsCount,
        },
        tasks: taskStats,
        members: membersCount,
      },
      myTasks,
      recentProjects,
      recentActivity: recentActivity.items || [],
    });
  } catch (error) {
    logger.error("Error fetching workspace overview", error);
    res.status(500).json({ error: "Failed to fetch workspace overview" });
  }
});

// GET /api/workspaces - List all workspaces for the current user
router.get("/", async (req: any, res) => {
  try {
    const userId = req.user.id;
    const workspaces = await prisma.workspace.findMany({
      where: {
        OR: [{ owner_id: userId }, { members: { some: { user_id: userId } } }],
      },
      include: {
        owner: { select: { id: true, full_name: true, email: true } },
        members: {
          include: {
            user: { select: { id: true, full_name: true, email: true } },
          },
        },
        _count: { select: { projects: true } },
      },
    });
    const workspacesWithRole = workspaces.map((ws: any) => {
      let role = ws.owner_id === userId ? "admin" : "viewer";
      const member = ws.members.find((m: any) => m.user_id === userId);
      if (member) role = member.role;
      return { ...ws, role };
    });
    res.json(workspacesWithRole);
  } catch (error) {
    logger.error("Error fetching workspaces", error);
    res.status(500).json({ error: "Failed to fetch workspaces" });
  }
});

// GET /api/workspaces/:id/metrics - Get recent activity and stats
router.get("/:id/metrics", async (req: any, res) => {
  try {
    const { id } = req.params;
    const {
      WorkspaceTaskService,
    } = require("../../services/workspaceTaskService");
    const { ProjectService } = require("../../services/projectService");

    const [recentTasks, recentProjects] = await Promise.all([
      WorkspaceTaskService.getRecentActivity(id, 10),
      ProjectService.getRecentProjects(req.user.id, 10, id), // Fetch workspace projects, up to 10
    ]);

    res.json({
      recentTasks,
      recentProjects,
    });
  } catch (error) {
    logger.error("Error fetching workspace metrics", error);
    res.status(500).json({ error: "Failed to fetch metrics" });
  }
});

// POST /api/workspaces/:id/notify - Broadcast a notification to all workspace members
router.post(
  "/:id/notify",
  checkWorkspaceRole("editor"),
  async (req: any, res) => {
    try {
      const { id } = req.params;
      const { type, title, message, data } = req.body;
      const userId = req.user.id;

      if (!type || !title || !message) {
        return res
          .status(400)
          .json({ error: "Type, title, and message are required" });
      }

      await broadcastGenericNotification(id, userId, type, title, message, data);

      res.json({ success: true, message: "Workspace notification broadcasted" });
    } catch (error) {
      logger.error("Error broadcasting workspace notification", error);
      res.status(500).json({ error: "Failed to broadcast notification" });
    }
  },
);

// POST /api/workspaces - Create a new workspace
router.post("/", async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { name, description, icon, templateId } = req.body;

    if (!name) return res.status(400).json({ error: "Name is required" });

    // --- Subscription Limits Check ---
    const userSubscription = await prisma.subscription.findUnique({
      where: { user_id: userId },
    });

    // Default to 'Free' if no subscription is found
    const plan = userSubscription?.plan?.toLowerCase() || "free";

    // Check current active workspaces count
    const activeWorkspacesCount = await prisma.workspace.count({
      where: { owner_id: userId },
    });

    if (plan === "free" && activeWorkspacesCount >= 1) {
      return res.status(403).json({
        error: "WORKSPACE_LIMIT_REACHED",
        message:
          "Free plan allows a maximum of 1 workspace. Please upgrade your plan to create more workspaces.",
      });
    } else if (plan === "plus" && activeWorkspacesCount >= 5) {
      return res.status(403).json({
        error: "WORKSPACE_LIMIT_REACHED",
        message:
          "Plus plan allows a maximum of 5 workspaces. Please upgrade your plan to create more workspaces.",
      });
    }
    // Premium plan is unlimited, so no check needed.
    // --- End Subscription Limits Check ---

    // 1. Create the workspace
    const workspace = await prisma.workspace.create({
      data: {
        name,
        description,
        icon,
        owner_id: userId,
        template_id: templateId || null,
        members: {
          create: {
            user_id: userId,
            role: "admin",
          },
        },
      },
    });

    // 2. If templateId is provided, apply template settings
    if (templateId) {
      const template = await prisma.workspaceTemplate.findUnique({
        where: { id: templateId },
      });

      if (template) {
        // Apply Labels
        if (template.labels && Array.isArray(template.labels)) {
          await prisma.workspaceLabel.createMany({
            data: template.labels.map((lc: any) => ({
              workspace_id: workspace.id,
              name: lc.name,
              color: lc.color || "#94a3b8",
            })),
          });
        }

        // Apply Custom Fields
        if (template.custom_fields && Array.isArray(template.custom_fields)) {
          for (const field of template.custom_fields as any[]) {
            await prisma.workspaceCustomField.create({
              data: {
                workspace_id: workspace.id,
                name: field.name,
                type: field.type || "text",
                options: field.options || null,
              },
            });
          }
        }

        // Apply Initial Tasks
        if (template.tasks && Array.isArray(template.tasks)) {
          await prisma.workspaceTask.createMany({
            data: template.tasks.map((task: any) => ({
              workspace_id: workspace.id,
              creator_id: userId,
              title: task.title,
              description: task.description || null,
              status: task.status || "todo",
            })),
          });
        }
      }
    }

    await WorkspaceActivityService.logActivity(
      workspace.id,
      userId,
      "WORKSPACE_CREATED",
      {
        name: workspace.name,
        template: templateId ? true : false,
      },
      req.ip,
    );

    res.json(workspace);
  } catch (error) {
    logger.error("Error creating workspace", error);
    res.status(500).json({ error: "Failed to create workspace" });
  }
});

// GET /api/workspaces/:id - Get specific workspace
router.get("/:id", async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const workspace = await prisma.workspace.findFirst({
      where: {
        id,
        OR: [{ owner_id: userId }, { members: { some: { user_id: userId } } }],
      },
      include: {
        projects: true,
        members: {
          include: {
            user: {
              select: {
                id: true,
                full_name: true,
                email: true,
                phone_number: true,
                field_of_study: true,
              },
            },
          },
        },
      },
    });

    if (!workspace)
      return res.status(404).json({ error: "Workspace not found" });

    let role = workspace.owner_id === userId ? "admin" : "viewer";
    const member = workspace.members.find((m: any) => m.user_id === userId);
    if (member) role = member.role;

    res.json({ ...workspace, role });
  } catch (error) {
    logger.error("Error fetching workspace", error);
    res.status(500).json({ error: "Failed to fetch workspace" });
  }
});

// PUT /api/workspaces/:id - Update workspace settings (owner or admin only)
router.put("/:id", checkWorkspaceRole("admin"), async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { name, description, icon } = req.body;

    const updated = await prisma.workspace.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(icon !== undefined && { icon }),
      },
    });

    await WorkspaceActivityService.logActivity(
      id,
      userId,
      "SETTINGS_UPDATED",
      { changes: req.body },
      req.ip,
    );

    res.json(updated);
  } catch (error) {
    logger.error("Error updating workspace", error);
    res.status(500).json({ error: "Failed to update workspace" });
  }
});

// DELETE /api/workspaces/:id - Delete workspace (owner only)
router.delete("/:id", checkWorkspaceRole("admin"), async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Only the owner can delete a workspace
    const workspace = await prisma.workspace.findFirst({
      where: { id, owner_id: userId },
    });

    if (!workspace) {
      return res
        .status(403)
        .json({ error: "Only the workspace owner can delete it" });
    }

    // Cascade delete will handle members, tasks, etc. (configured in schema)
    await prisma.workspace.delete({ where: { id } });

    res.json({ message: "Workspace deleted successfully" });
  } catch (error) {
    logger.error("Error deleting workspace", error);
    res.status(500).json({ error: "Failed to delete workspace" });
  }
});

// POST /api/workspaces/:id/invite - Invite a member by email
router.post(
  "/:id/invite",
  checkWorkspaceRole("admin"),
  async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { email, role = "viewer" } = req.body;

      const workspace = await prisma.workspace.findUnique({
        where: { id },
        include: { owner: { select: { full_name: true, email: true } } },
      });

      if (!workspace) {
        return res.status(404).json({ error: "Workspace not found" });
      }

      // --- Subscription Limits Check (Collaborators) ---
      const ownerId = workspace.owner_id;
      const ownerSubscription = await prisma.subscription.findUnique({
        where: { user_id: ownerId },
      });
      const plan = ownerSubscription?.plan?.toLowerCase() || "free";

      // Count existing members (excluding owner)
      const existingMembersCount = await prisma.workspaceMember.count({
        where: {
          workspace_id: id,
          user_id: { not: ownerId },
        },
      });

      // Count pending invitations
      const pendingInvitationsCount = await prisma.workspaceInvitation.count({
        where: {
          workspace_id: id,
          status: "pending",
        },
      });

      const totalCollaborators = existingMembersCount + pendingInvitationsCount;

      if (plan === "free" && totalCollaborators >= 2) {
        return res.status(403).json({
          error: "COLLABORATOR_LIMIT_REACHED",
          message:
            "Free plan allows a maximum of 2 collaborators per workspace. The workspace owner must upgrade to invite more members.",
        });
      } else if (plan === "plus" && totalCollaborators >= 10) {
        return res.status(403).json({
          error: "COLLABORATOR_LIMIT_REACHED",
          message:
            "Plus plan allows a maximum of 10 collaborators per workspace. The workspace owner must upgrade to invite more members.",
        });
      }
      // Premium plan is unlimited
      // --- End Subscription Limits Check ---

      // Check if user exists (for notification purposes only)
      const userToInvite = await prisma.user.findUnique({ where: { email } });

      // Check if already a member
      if (userToInvite) {
        const existingMember = await prisma.workspaceMember.findUnique({
          where: {
            workspace_id_user_id: { workspace_id: id, user_id: userToInvite.id },
          },
        });
        if (existingMember) {
          return res.status(400).json({ error: "User is already a member" });
        }
      }

      // Check for existing pending invitation
      const existingInvite = await prisma.workspaceInvitation.findUnique({
        where: { workspace_id_email: { workspace_id: id, email } },
      });

      if (existingInvite && existingInvite.status === "pending") {
        return res.status(400).json({ error: "Invitation already sent" });
      }

      // Create invitation (7 days expiry)
      const invitation = await prisma.workspaceInvitation.create({
        data: {
          workspace_id: id,
          email,
          role,
          invited_by: userId,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      await WorkspaceActivityService.logActivity(
        id,
        userId,
        "INVITATION_SENT",
        { email, role },
        req.ip,
      );

      // Notify invited user if they already exist in the system
      if (userToInvite) {
        try {
          const {
            createNotification,
          } = require("../../services/notificationService");
          await createNotification(
            userToInvite.id,
            "collaboration_invite",
            "New Workspace Invitation",
            `You have been invited to join the workspace "${workspace.name}" as a ${role}.`,
            { workspaceId: id, invitationId: invitation.id },
          );
        } catch (notifError) {
          logger.error("Failed to send invitation notification:", notifError);
        }
      }

      // Send email notification
      try {
        const EmailService =
          require("../../services/emailService").EmailService;
        const SecretsService =
          require("../../services/secrets-service").default;
        const frontendUrl = await SecretsService.getFrontendUrl();

        await EmailService.sendWorkspaceInvitation({
          to: email,
          workspaceName: workspace.name,
          inviterName: req.user.full_name || req.user.email,
          role,
          acceptUrl: `${frontendUrl}/workspaces/accept/${invitation.token}`,
          expiresAt: invitation.expires_at,
        });
      } catch (emailError) {
        logger.error("Failed to send invitation email:", emailError);
        // Continue even if email fails - user can still see invitation in dashboard
      }

      res.json({
        message: "Invitation sent successfully",
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expires_at: invitation.expires_at,
        },
      });
    } catch (error) {
      logger.error("Error inviting member", error);
      res.status(500).json({ error: "Failed to send invitation" });
    }
  },
);

// PUT /api/workspaces/:id/members/:memberId - Update member role
router.put(
  "/:id/members/:memberId",
  checkWorkspaceRole("admin"),
  async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id, memberId } = req.params;
      const { role } = req.body;

      if (!["admin", "editor", "viewer"].includes(role)) {
        return res
          .status(400)
          .json({ error: "Invalid role. Must be admin, editor, or viewer" });
      }

      // Previous manual checks removed as middleware handles base permission
      const workspace = await prisma.workspace.findUnique({
        where: { id },
      });

      if (!workspace) {
        return res.status(404).json({ error: "Workspace not found" });
      }

      // Prevent changing the owner's role
      const targetMember = await prisma.workspaceMember.findUnique({
        where: { id: memberId },
      });

      if (!targetMember || targetMember.workspace_id !== id) {
        return res.status(404).json({ error: "Member not found" });
      }

      if (targetMember.user_id === workspace.owner_id) {
        return res
          .status(400)
          .json({ error: "Cannot change the workspace owner's role" });
      }

      const updated = await prisma.workspaceMember.update({
        where: { id: memberId },
        data: { role },
        include: {
          user: {
            select: { id: true, full_name: true, email: true },
          },
        },
      });

      await WorkspaceActivityService.logActivity(
        id,
        userId,
        "MEMBER_ROLE_UPDATED",
        { memberId, role, memberEmail: updated.user.email },
        req.ip,
      );

      // Broadcast role change notification to all workspace members
      try {
        const {
          broadcastWorkspaceNotification,
        } = require("../../services/notificationService");
        await broadcastWorkspaceNotification(
          id,
          userId,
          "permission_change",
          {
            actor: () => ({
              title: "Role Updated",
              message: `You changed ${updated.user.full_name || updated.user.email}'s role to ${role} in "${workspace.name}".`,
            }),
            recipient: (actorName: string) => ({
              title: "Your Role Was Updated",
              message: `${actorName} changed your role to ${role} in "${workspace.name}".`,
            }),
            others: (actorName: string, recipientName?: string) => ({
              title: "Member Role Updated",
              message: `${actorName} changed ${recipientName}'s role to ${role} in "${workspace.name}".`,
            }),
          },
          { workspaceId: id },
          [updated.user_id],
        );
      } catch (notifError) {
        logger.error("Failed to send role update notification:", notifError);
      }

      res.json(updated);
    } catch (error) {
      logger.error("Error updating member role", error);
      res.status(500).json({ error: "Failed to update member role" });
    }
  },
);

// DELETE /api/workspaces/:id/members/:memberId - Remove member from workspace
router.delete(
  "/:id/members/:memberId",
  checkWorkspaceRole("admin"),
  async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id, memberId } = req.params;

      // Previous manual checks removed as middleware handles base permission
      const workspace = await prisma.workspace.findUnique({
        where: { id },
      });

      if (!workspace) {
        return res.status(404).json({ error: "Workspace not found" });
      }

      const targetMember = await prisma.workspaceMember.findUnique({
        where: { id: memberId },
        include: { user: true },
      });

      if (!targetMember || targetMember.workspace_id !== id) {
        return res.status(404).json({ error: "Member not found" });
      }

      // Prevent removing the workspace owner
      if (targetMember.user_id === workspace.owner_id) {
        return res
          .status(400)
          .json({ error: "Cannot remove the workspace owner" });
      }

      await prisma.workspaceMember.delete({ where: { id: memberId } });

      await WorkspaceActivityService.logActivity(
        id,
        userId,
        "MEMBER_REMOVED",
        { memberId, memberUserId: targetMember.user_id },
        req.ip,
      );

      // Send email notification to removed member
      try {
        const { EmailService } = require("../../services/emailService");

        let removerName = "an administrator";
        if (req.user) {
          removerName =
            req.user.user_metadata?.full_name ||
            req.user.email ||
            "an administrator";
        }

        if (targetMember.user?.email) {
          await EmailService.sendWorkspaceRemovalEmail({
            to: targetMember.user.email,
            fullName: targetMember.user.full_name || "",
            workspaceName: workspace.name,
            removerName,
          });
        }
      } catch (emailError) {
        logger.error("Failed to send workspace removal email", emailError);
      }

      res.json({ message: "Member removed successfully" });
    } catch (error) {
      logger.error("Error removing member", error);
      res.status(500).json({ error: "Failed to remove member" });
    }
  },
);

// GET /api/workspaces/:id/invitations - Get all invitations for a workspace
router.get(
  "/:id/invitations",
  checkWorkspaceRole("admin"),
  async (req: any, res) => {
    try {
      const { id } = req.params;
      const invitations = await prisma.workspaceInvitation.findMany({
        where: { workspace_id: id },
        include: {
          inviter: {
            select: { id: true, full_name: true, email: true },
          },
        },
        orderBy: { created_at: "desc" },
      });
      res.json(invitations);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

// DELETE /api/workspaces/:id/invitations/:invitationId - Revoke an invitation
router.delete(
  "/:id/invitations/:invitationId",
  checkWorkspaceRole("admin"),
  async (req: any, res) => {
    try {
      const { id, invitationId } = req.params;
      await prisma.workspaceInvitation.delete({
        where: {
          id: invitationId,
          workspace_id: id,
        },
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

// GET /api/workspaces/invitations/pending - Get pending invitations for current user
router.get("/invitations/pending", async (req: any, res) => {
  try {
    const email = req.user.email;
    const invitations = await prisma.workspaceInvitation.findMany({
      where: {
        email,
        status: "pending",
        expires_at: { gt: new Date() },
      },
      include: {
        workspace: {
          select: { id: true, name: true, description: true },
        },
        inviter: {
          select: { full_name: true, email: true },
        },
      },
      orderBy: { created_at: "desc" },
    });
    res.json(invitations);
  } catch (error) {
    logger.error("Error fetching pending invitations", error);
    res.status(500).json({ error: "Failed to fetch invitations" });
  }
});

// POST /api/workspaces/invitations/:token/accept - Accept workspace invitation
router.post("/invitations/:token/accept", async (req: any, res) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;
    const userEmail = req.user.email;

    const invitation = await prisma.workspaceInvitation.findUnique({
      where: { token },
      include: { workspace: true },
    });

    if (!invitation) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    if (invitation.email !== userEmail) {
      return res
        .status(403)
        .json({ error: "This invitation is for a different email" });
    }

    if (invitation.status !== "pending") {
      return res
        .status(400)
        .json({ error: `Invitation already ${invitation.status}` });
    }

    if (invitation.expires_at < new Date()) {
      await prisma.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { status: "expired" },
      });
      return res.status(410).json({ error: "Invitation has expired" });
    }

    // Add user to workspace
    const member = await prisma.workspaceMember.create({
      data: {
        workspace_id: invitation.workspace_id,
        user_id: userId,
        role: invitation.role,
      },
    });

    // Mark invitation as accepted
    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: "accepted" },
    });

    await WorkspaceActivityService.logActivity(
      invitation.workspace_id,
      userId,
      "MEMBER_JOINED",
      { email: userEmail, role: invitation.role },
      req.ip,
    );

    // Notify workspace owner that someone joined
    try {
      const {
        createNotification,
      } = require("../../services/notificationService");
      await createNotification(
        invitation.workspace.owner_id,
        "new_collaborator",
        "New Member Joined",
        `${req.user.full_name || userEmail} has joined the workspace "${invitation.workspace.name}"`,
        { workspaceId: invitation.workspace_id },
      );
    } catch (notifError) {
      logger.error("Failed to send join notification:", notifError);
    }

    res.json({
      message: "Invitation accepted successfully",
      workspace: invitation.workspace,
      member,
    });
  } catch (error) {
    logger.error("Error accepting invitation", error);
    res.status(500).json({ error: "Failed to accept invitation" });
  }
});

// POST /api/workspaces/invitations/:token/decline - Decline workspace invitation
router.post("/invitations/:token/decline", async (req: any, res) => {
  try {
    const { token } = req.params;
    const userEmail = req.user.email;

    const invitation = await prisma.workspaceInvitation.findUnique({
      where: { token },
    });

    if (!invitation) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    if (invitation.email !== userEmail) {
      return res
        .status(403)
        .json({ error: "This invitation is for a different email" });
    }

    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: "declined" },
    });

    res.json({ message: "Invitation declined" });
  } catch (error) {
    logger.error("Error declining invitation", error);
    res.status(500).json({ error: "Failed to decline invitation" });
  }
});

export default router;
