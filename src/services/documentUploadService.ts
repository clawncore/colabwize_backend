import { prisma } from "../lib/prisma";
import { Request } from "express";
import fs from "fs/promises";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { RecycleBinService } from "./recycleBinService";
import logger from "../monitoring/logger";

interface ExtendedRequest extends Request {
  user?: {
    id: string;
    email: string;
    full_name?: string;
  };
}

export class DocumentUploadService {
  /**
   * Creates a project with an uploaded document
   */
  static async createProjectWithDocument(
    userId: string,
    title: string,
    description: string,
    file: Express.Multer.File
  ) {
    // Extract text/html from the uploaded document
    const { content: extractedContent, format } =
      await this.extractTextFromDocument(file);

    // Count words in the document
    const wordCount = this.countWords(extractedContent);

    // Prepare content for database
    // If HTML, store as is (Tiptap finds HTML string acceptable for setContent)
    // If text, wrap in Tiptap JSON structure
    const projectContent =
      format === "html"
        ? extractedContent
        : {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: extractedContent,
                  },
                ],
              },
            ],
          };

    // Create project record in the database
    const project = await prisma.project.create({
      data: {
        user_id: userId,
        title,
        description,
        content: projectContent,
        word_count: wordCount,
        file_path: file.path,
        file_type: file.mimetype,
      },
      include: {
        originality_scans: true,
        citations: true,
      },
    });

    return project;
  }

  /**
   * Gets all projects for a user
   */
  static async getUserProjects(userId: string) {
    return await prisma.project.findMany({
      where: {
        user_id: userId,
      },
      orderBy: {
        created_at: "desc",
      },
      include: {
        originality_scans: {
          orderBy: {
            created_at: "desc",
          },
          take: 1, // Get most recent scan
        },
      },
    });
  }

  /**
   * Gets a specific project by ID for a user
   */
  static async getProjectById(projectId: string, userId: string) {
    return await prisma.project.findFirst({
      where: {
        id: projectId,
        user_id: userId,
      },
      include: {
        originality_scans: {
          orderBy: {
            created_at: "desc",
          },
        },

        citations: true,
      },
    });
  }

  /**
   * DEBUG ONLY: Checks if a project exists by ID (ignoring user_id)
   * Returns validation info
   */
  static async checkProjectExists(projectId: string) {
    const project = await prisma.project.findUnique({
      where: {
        id: projectId,
      },
      select: {
        id: true,
        user_id: true,
        title: true,
      },
    });
    return project;
  }

  /**
   * Updates a project
   */
  static async updateProject(
    projectId: string,
    userId: string,
    title: string,
    description: string,
    content: any,
    wordCount: number
  ) {
    // Update project record
    const updatedProject = await prisma.project.update({
      where: {
        id: projectId,
        user_id: userId,
      },
      data: {
        title,
        description,
        content,
        word_count: wordCount,
        updated_at: new Date(),
      },
      include: {
        originality_scans: true,
        citations: true,
      },
    });

    return updatedProject;
  }

  /**
   * Deletes a project
   */
  static async deleteProject(projectId: string, userId: string) {
    // INFO: Check for existence first to provide better errors
    const project = await this.checkProjectExists(projectId);

    if (!project) {
      throw new Error("Project ID not found in database");
    }

    // Delete access denied check
    if (project.user_id !== userId) {
      logger.warn(
        `[DEBUG] Delete access denied. Owner: ${project.user_id}, Requestor: ${userId}`
      );
      throw new Error(
        `Access denied: Project owned by ${project.user_id}, not ${userId}`
      );
    }

    // Get full project details for recycle bin
    const fullProject = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (fullProject) {
      // Add to recycle bin
      await RecycleBinService.addItemToRecycleBin(userId, "project", {
        id: fullProject.id,
        title: fullProject.title,
        description: fullProject.description,
        content: fullProject.content,
        word_count: fullProject.word_count,
        file_path: fullProject.file_path,
        file_type: fullProject.file_type,
      });
    }

    // Delete project record by ID (safe since we verified ownership)
    const deletedProject = await prisma.project.delete({
      where: {
        id: projectId,
      },
    });

    return deletedProject;
  }

  /**
   * Creates a project without an uploaded document
   */
  static async createProject(
    userId: string,
    title: string,
    description: string,
    content: any
  ) {
    // Create project record in the database
    const project = await prisma.project.create({
      data: {
        user_id: userId,
        title,
        description,
        content: content || {
          type: "doc",
          content: [
            {
              type: "paragraph",
            },
          ],
        },
        word_count: content ? this.countWords(JSON.stringify(content)) : 0,
      },
      include: {
        originality_scans: true,
        citations: true,
      },
    });

    return project;
  }

  /**
   * Extracts text or HTML from various document formats
   * Returns an object with content and format type
   */
  public static async extractTextFromDocument(
    file: Express.Multer.File
  ): Promise<{ content: string; format: "text" | "html" }> {
    try {
      if (!file) {
        throw new Error("File is required for text extraction");
      }

      const filePath = file.path;
      const fileExtension = file.originalname.split(".").pop()?.toLowerCase();

      if (!fileExtension) {
        throw new Error("File extension not found");
      }

      switch (fileExtension) {
        case "pdf":
          const pdfText = await this.extractTextFromPDF(filePath);
          // Clean PDF text: remove hard wraps within paragraphs
          // 1. Replace single newlines that are likely hard wraps with spaces
          //    Look for: non-punctuation followed by newline followed by non-newline
          const cleanedText = pdfText
            .replace(/([^\n.!?])\n([^\n])/g, "$1 $2")
            // 2. Reduce multiple newlines to max 2 (paragraph break)
            .replace(/\n{3,}/g, "\n\n");

          return { content: cleanedText, format: "text" };

        case "docx":
          const html = await this.extractHtmlFromDOCX(filePath);
          return { content: html, format: "html" };

        case "txt":
        case "rtf":
        case "odt":
          // For text-based formats, read the file directly
          const content = await fs.readFile(filePath, "utf8");
          return { content, format: "text" };

        default:
          return {
            content: `Content from ${file.originalname}`,
            format: "text",
          };
      }
    } catch (error: any) {
      logger.error("Error extracting text from document", {
        error: error.message,
        fileName: file?.originalname,
      });
      return {
        content: `Content from ${file?.originalname || "unknown file"}`,
        format: "text",
      };
    }
  }

  /**
   * Extracts text from PDF files
   */
  private static async extractTextFromPDF(filePath: string): Promise<string> {
    try {
      const data = await pdfParse(await fs.readFile(filePath));
      return data.text;
    } catch (error) {
      logger.error("Error parsing PDF", { error, filePath });
      throw error;
    }
  }

  /**
   * Extracts HTML from DOCX files using mammoth
   * This preserves formatting like bold, italic, and structure
   */
  private static async extractHtmlFromDOCX(filePath: string): Promise<string> {
    try {
      const result = await mammoth.convertToHtml({ path: filePath });
      return result.value;
    } catch (error) {
      logger.error("Error parsing DOCX to HTML", { error, filePath });
      throw error;
    }
  }

  /**
   * Counts words in a text string (strips HTML tags if present)
   */
  private static countWords(text: string): number {
    if (!text) return 0;
    // Strip HTML tags for word count
    const plainText = text.replace(/<[^>]*>/g, " ");
    return plainText.trim() === "" ? 0 : plainText.trim().split(/\s+/).length;
  }
}
