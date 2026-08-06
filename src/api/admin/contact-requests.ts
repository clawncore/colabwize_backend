import { Router, Request, Response } from "express";
import { prisma } from "../../lib/prisma";

const router = Router();

// GET /api/admin/contact-requests - List all contact requests with filters
router.get("/", async (req: Request, res: Response) => {
  try {
    const { status, search, page = "1", limit = "20" } = req.query;

    const where: any = {};
    if (status && status !== "all") {
      where.status = status;
    }
    if (search && typeof search === "string") {
      where.OR = [
        { ticket_number: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { subject: { contains: search, mode: "insensitive" } },
      ];
    }

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 20;
    const skip = (pageNum - 1) * limitNum;

    const [requests, total] = await Promise.all([
      prisma.contactRequest.findMany({
        where,
        include: {
          attachments: true,
        },
        orderBy: { created_at: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.contactRequest.count({ where }),
    ]);

    // Status counts for tabs
    const statusCounts = await prisma.contactRequest.groupBy({
      by: ["status"],
      _count: true,
    });

    res.json({
      success: true,
      data: requests,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
      statusCounts: statusCounts.reduce(
        (acc, row) => ({ ...acc, [row.status]: row._count }),
        {} as Record<string, number>
      ),
    });
  } catch (error: any) {
    console.error("Error fetching contact requests:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/contact-requests/:ticketNumber - Get single ticket with full details
router.get("/:ticketNumber", async (req: Request, res: Response) => {
  try {
    const { ticketNumber } = req.params;

    const request = await prisma.contactRequest.findFirst({
      where: { ticket_number: ticketNumber },
      include: { attachments: true },
    });

    if (!request) {
      res.status(404).json({ success: false, error: "Ticket not found" });
      return;
    }

    res.json({ success: true, data: request });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/admin/contact-requests/:ticketNumber/status - Update ticket status
router.patch("/:ticketNumber/status", async (req: Request, res: Response) => {
  try {
    const { ticketNumber } = req.params;
    const { status } = req.body;

    if (!["new", "replied", "resolved", "spam"].includes(status)) {
      res.status(400).json({ success: false, error: "Invalid status" });
      return;
    }

    const updated = await prisma.contactRequest.update({
      where: { ticket_number: ticketNumber },
      data: {
        status,
        replied_at: ["replied", "resolved"].includes(status) ? new Date() : undefined,
        updated_at: new Date(),
      },
    });

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/admin/contact-requests/:ticketNumber - Delete ticket
router.delete("/:ticketNumber", async (req: Request, res: Response) => {
  try {
    const { ticketNumber } = req.params;

    await prisma.contactRequest.delete({
      where: { ticket_number: ticketNumber },
    });

    res.json({ success: true, message: "Ticket deleted" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
