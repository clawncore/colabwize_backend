import { Router, type Router as ExpressRouter } from "express";
import { SupportTicketService } from "../../services/supportTicketService";
import logger from "../../monitoring/logger";
import { authenticateExpressRequest } from "../../middleware/auth";

const router: ExpressRouter = Router();

// Create a new support ticket
router.post("/", authenticateExpressRequest, async (req, res) => {
  try {
    // User ID will be attached by the authentication middleware in main-server.ts
    const userId = (req as any).user?.id;
    const ticketData = req.body;

    // Validate required fields
    if (!ticketData.subject || !ticketData.message) {
      return res.status(400).json({
        success: false,
        message: "Subject and message are required",
      });
    }

    const validSubjects = ["technical", "billing", "feature", "bug", "other"];
    if (!validSubjects.includes(ticketData.subject)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subject",
      });
    }

    const validPriorities = ["low", "normal", "high", "urgent"];
    if (ticketData.priority && !validPriorities.includes(ticketData.priority)) {
      return res.status(400).json({
        success: false,
        message: "Invalid priority level",
      });
    }

    const ticket = await SupportTicketService.createSupportTicket({
      user_id: userId || null,
      subject: ticketData.subject,
      message: ticketData.message,
      priority: ticketData.priority || "normal",
      attachment_url: ticketData.attachmentUrl || null,
      browser_info: ticketData.browserInfo || null,
      os_info: ticketData.osInfo || null,
      screen_size: ticketData.screenSize || null,
      user_plan: ticketData.userPlan || null,
    });

    return res.json({ success: true, ticket });
  } catch (error) {
    logger.error("Error creating support ticket:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create support ticket",
    });
  }
});

// Get tickets for the authenticated user
router.get("/", authenticateExpressRequest, async (req, res) => {
  try {
    // User ID will be attached by the authentication middleware in main-server.ts
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const tickets = await SupportTicketService.getUserTickets(userId);

    return res.json({ success: true, tickets });
  } catch (error) {
    logger.error("Error fetching user tickets:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user tickets",
    });
  }
});

// Get a specific ticket by ID
router.get("/:id", authenticateExpressRequest, async (req, res) => {
  try {
    const { id } = req.params;

    // User ID will be attached by the authentication middleware in main-server.ts
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const ticket = await SupportTicketService.getTicketById(userId, id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    return res.json({ success: true, ticket });
  } catch (error: any) {
    if (error.message === "Unauthorized access to ticket") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    logger.error("Error fetching ticket by ID:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch ticket",
    });
  }
});

// Update ticket status (admin only)
router.patch("/:id/status", authenticateExpressRequest, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const validStatuses = ["open", "in_progress", "resolved", "closed"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    // User ID will be attached by the authentication middleware in main-server.ts
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const ticket = await SupportTicketService.updateTicketStatus(
      userId,
      id,
      status,
      adminNotes
    );

    return res.json({ success: true, ticket });
  } catch (error: any) {
    if (error.message === "Only administrators can update ticket status") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin privileges required.",
      });
    }

    logger.error("Error updating ticket status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update ticket status",
    });
  }
});

export default router;
