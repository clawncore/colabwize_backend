import express, { Request, Response } from "express";
import { authenticateExpressRequest } from "../../middleware/auth";
import { WorkspaceActivityService } from "../../services/workspaceActivityService";
import { checkWorkspaceRole } from "../../middleware/role";

const router = express.Router();

interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        email?: string;
    };
}

// Get Activity Log for a Workspace
router.get(
    "/:id/activity",
    authenticateExpressRequest,
    checkWorkspaceRole("viewer"),
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const workspaceId = req.params.id as string;
            const userId = req.user!.id;
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = parseInt(req.query.offset as string) || 0;

            const { action, userId: filterUserId, startDate, endDate } = req.query;

            // Manual checks removed as middleware handles it

            const activities = await WorkspaceActivityService.getActivities(
                workspaceId,
                limit,
                offset,
                {
                    userId: filterUserId ? String(filterUserId) : undefined,
                    action: action ? String(action) : undefined,
                    startDate: startDate ? new Date(String(startDate)) : undefined,
                    endDate: endDate ? new Date(String(endDate)) : undefined,
                }
            );

            return res.json(activities);
        } catch (error: any) {
            console.error("Error fetching activities:", error);
            return res.status(500).json({ error: "Failed to fetch activities" });
        }
    }
);

export default router;
