import { Request, Response } from "express";
import { DraftComparisonService } from "../services/draftComparisonService";
import logger from "../monitoring/logger";
import { DocumentUploadService } from "../services/documentUploadService";

export class DraftComparisonController {
  /**
   * Compare two drafts (current project vs. uploaded file or another project)
   */
  static async compareDrafts(req: Request, res: Response) {
    try {
      const { projectId: paramProjectId } = req.params;
      // 1. Get Current Draft Content
      let currentText = "";

      const {
        projectId: bodyProjectId,
        comparisonType,
        previousProjectId,
        currentDraft,
      } = req.body;
      const projectId = paramProjectId || bodyProjectId;
      const file = req.file;
      const userId = (req as any).user?.id;

      if (currentDraft) {
        // Option A: Direct text input (from "Paste Text" tab)
        currentText = currentDraft;
      } else if (projectId) {
        // Option B: From existing project
        const currentProject = await DocumentUploadService.getProjectById(
          projectId,
          userId
        );
        if (!currentProject) {
          return res.status(404).json({ error: "Current project not found" });
        }
        currentText =
          typeof currentProject.content === "string"
            ? currentProject.content
            : JSON.stringify(currentProject.content);
      } else {
        return res
          .status(400)
          .json({ error: "Missing current draft content or project ID" });
      }

      let previousText = "";

      // 2. Get Previous Draft Content
      if (comparisonType === "file" && file) {
        // Parse uploaded file using the shared service
        const detectionResult =
          await DocumentUploadService.extractTextFromDocument(file);
        previousText = detectionResult.content;
      } else if (comparisonType === "text" && req.body.previousDraft) {
        // Direct text input for previous draft
        previousText = req.body.previousDraft;
      } else if (comparisonType === "project" && previousProjectId) {
        const prevProject = await DocumentUploadService.getProjectById(
          previousProjectId,
          userId
        );
        if (!prevProject) {
          return res.status(404).json({ error: "Previous project not found" });
        }
        previousText =
          typeof prevProject.content === "string"
            ? prevProject.content
            : JSON.stringify(prevProject.content);
      } else {
        return res.status(400).json({ error: "Invalid comparison source" });
      }

      // 3. Compare
      const result = await DraftComparisonService.compareDrafts(
        currentText,
        previousText
      );

      return res.json(result);
    } catch (error: any) {
      logger.error("Error in compareDrafts controller", {
        error: error.message,
      });
      return res.status(500).json({ error: error.message });
    }
  }
}
