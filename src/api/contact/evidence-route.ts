import { Router, Request, Response } from "express";
import multer from "multer";
import { ContactEvidenceService } from "../../services/contactEvidenceService";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
  },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/png", "image/webp", "image/gif",
      "application/pdf",
      "text/plain", "text/csv",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

router.post(
  "/upload",
  upload.array("files", 5),
  async (req: Request, res: Response) => {
    try {
      const { ticketNumber } = req.body;
      if (!ticketNumber) {
        res.status(400).json({ success: false, error: "ticketNumber required" });
        return;
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({ success: false, error: "No files provided" });
        return;
      }

      // Find the contact request
      const { prisma } = await import("../../lib/prisma");
      const contactRequest = await prisma.contactRequest.findFirst({
        where: { ticket_number: ticketNumber },
      });

      if (!contactRequest) {
        res.status(404).json({ success: false, error: "Ticket not found" });
        return;
      }

      // Upload each file
      const uploaded = [];
      for (const file of files) {
        const result = await ContactEvidenceService.uploadEvidence(
          file.buffer,
          file.originalname,
          file.mimetype,
          ticketNumber
        );
        uploaded.push(result);
      }

      // Link to contact request
      await ContactEvidenceService.attachToContactRequest(
        contactRequest.id,
        uploaded
      );

      res.json({
        success: true,
        message: `${uploaded.length} file(s) attached to ticket ${ticketNumber}`,
        files: uploaded.map((f) => ({
          name: f.fileName,
          type: f.fileType,
          size: f.fileSize,
          url: f.fileUrl,
        })),
      });
    } catch (error: any) {
      console.error("Contact evidence upload error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

export default router;
