import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { ExportService } from "../../services/exportService";
import { StorageService } from "../../services/storageService";

// Define a generic request interface that works for both web Request and our mock
import { ContentNormalizer } from "../../services/contentNormalizer";

interface FileProcessingRequest {

  json(): Promise<{
    fileData: any;
    fileType: string;
    userId: string;
  }>;
}

// Serverless function for file processing (document uploads, exports, etc.)
export default async function fileProcessing(req: FileProcessingRequest) {
  try {
    // Extract file data from request
    const requestData = (await req.json()) as {
      fileData: any;
      fileType: string;
      userId: string;
    };
    const { fileData, fileType, userId } = requestData;

    // Process file based on type
    let result;
    switch (fileType) {
      case "document-import":
        result = await processDocumentImport(fileData, userId);
        break;
      case "export-pdf":
        result = await generatePDFExport(fileData, userId);
        break;
      case "export-docx":
        result = await generateDOCXExport(fileData, userId);
        break;
      case "export-txt":
        result = await generateTXTExport(fileData, userId);
        break;
      case "export-latex":
        result = await generateLaTeXExport(fileData, userId);
        break;
      case "export-rtf":
        result = await generateRTFExport(fileData, userId);
        break;
      default:
        throw new Error("Unsupported file type");
    }

    return new Response(
      JSON.stringify({
        success: true,
        result,
        message: "File processed successfully",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    logger.error("File processing failed", { error: error.message });
    return new Response(
      JSON.stringify({
        success: false,
        message: error.message || "File processing failed",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// Process document import
async function processDocumentImport(fileData: any, userId: string) {
  try {
    // Validate user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    // Check storage limit
    const storageInfo = await StorageService.getUserStorageInfo(userId);
    const newStorageUsed = storageInfo.used + 0.01; // Estimate 10KB for new document

    if (newStorageUsed > storageInfo.limit) {
      throw new Error("Storage limit exceeded");
    }

    // Create project from imported document
    const project = await prisma.project.create({
      data: {
        user_id: userId,
        title: fileData.title || "Imported Document",
        type: fileData.type || "research-paper",
        citation_style: fileData.citationStyle || "apa",
        content: fileData.content || {},
        word_count: fileData.wordCount || 0,
        status: "draft",
      },
    });

    // Update user's storage usage
    await prisma.user.update({
      where: { id: userId },
      data: {
        storage_used: newStorageUsed,
      },
    });

    logger.info("Document imported successfully", {
      projectId: project.id,
      userId,
    });

    return {
      projectId: project.id,
      wordCount: project.word_count,
      processedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error("Error processing document import", { error });
    throw error;
  }
}

// Generate PDF export
// Generate PDF export
async function generatePDFExport(fileData: any, userId: string) {
  try {
    // Validate user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user) {
      throw new Error("User not found");
    }

    // --- Subscription & Limit Logic ---
    // Check if user is on a paid plan
    const isPaid = user.subscription?.status === "active" && user.subscription?.plan !== "free"; // Adjust based on your plan names

    if (!isPaid) {
      // Free User Logic: Check limits
      const now = new Date();
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Count PDF exports this month
      const exportCount = await prisma.export.count({
        where: {
          user_id: userId,
          file_type: "pdf",
          status: "completed",
          created_at: { gte: firstDayOfMonth },
        },
      });

      // Limit: 2 Free, then Charge
      if (exportCount >= 2) {
        // Check Credit Balance
        const { CreditService } = await import("../../services/CreditService");
        const balance = await CreditService.getBalance(userId);

        // Charge 1 Credit (Int schema doesn't support 0.5)
        // User requested 0.5, but system is Int based. Using 1 as minimum unit.
        const COST = 1;

        if (balance < COST) {
          throw new Error("INSUFFICIENT_CREDITS"); // Specific error code for frontend
        }

        // Deduct Credit
        await CreditService.addCredits(
          userId,
          -COST,
          "USAGE",
          `export_pdf_${Date.now()}`,
          "PDF Export (Free Limit Exceeded)"
        );
      }
    }
    // ----------------------------------

    let project;
    // Check if we have project data directly or need to fetch from DB
    if (fileData.id) {
      // Project data provided directly from editor
      project = {
        id: fileData.id,
        title: fileData.title,
        content: fileData.content,
        user_id: userId,
      };
    } else {
      // Fetch project from DB by ID
      project = await prisma.project.findUnique({
        where: {
          id: fileData.projectId,
          user_id: userId,
        },
      });

      if (!project) {
        throw new Error("Project not found or access denied");
      }
    }

    // Generate PDF using ExportService
    // Normalize content (resolve images, fix tables)
    const { ContentNormalizer } = await import("../../services/contentNormalizer");
    const normalizedContent = await ContentNormalizer.normalizeContent(project.content);

    const exportResult = await ExportService.exportProject(
      project.id,
      userId,
      {
        format: "pdf",
        contentOverride: normalizedContent,
        includeCitations: fileData.includeCitations ?? true,
        includeComments: fileData.includeComments ?? false,
        includeAuthorshipCertificate: fileData.includeAuthorshipCertificate ?? false,
        citationStyle: fileData.citationStyle || "apa",
        pageSize: fileData.pageSize || "A4",
        orientation: fileData.orientation || "portrait",
        journalTemplate: fileData.journalTemplate || "",
        journalReady: !!fileData.journalTemplate,
        metadata: {
          author: fileData.metadata?.author || user.full_name || "Unknown Author",
          institution: fileData.metadata?.institution,
          course: fileData.metadata?.course,
          instructor: fileData.metadata?.instructor,
          runningHead: fileData.metadata?.runningHead,
          abstract: fileData.metadata?.abstract,
        },
      }
    );

    // Upload the file to Supabase Storage
    const { SupabaseStorageService } =
      await import("../../services/supabaseStorageService");

    // Upload file
    const uploadResult = await SupabaseStorageService.uploadFile(
      exportResult.buffer,
      `${project.title}.pdf`,
      "application/pdf",
      userId,
      {
        userId,
        fileName: `${project.title}.pdf`,
        fileType: "pdf",
        fileSize: exportResult.fileSize,
        projectId: fileData.projectId,
        createdAt: new Date(),
      }
    );

    // Sanitize filename for download
    const sanitizedTitle = project.title.replace(/[^a-zA-Z0-9-_]/g, "_");

    // Generate a signed URL for secure download (valid for 1 hour)
    const downloadUrl = await SupabaseStorageService.createSignedUrl(
      uploadResult.path,
      3600, // 1 hour expiration
      { download: `${sanitizedTitle}.pdf` } // Force download with correct filename
    );

    // Store export record in database
    await prisma.export.create({
      data: {
        user_id: userId,
        project_id: project.id,
        file_name: `${project.title}.pdf`,
        file_size: exportResult.fileSize,
        file_type: "pdf",
        download_url: downloadUrl,
        status: "completed",
      },
    });

    logger.info("PDF export generated successfully", {
      projectId: fileData.projectId,
      userId,
      fileSize: exportResult.fileSize,
    });

    return {
      downloadUrl,
      fileSize: exportResult.fileSize,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error("Error generating PDF export", { error });

    // Store failed export record in database
    // Only if it wasn't a credit error (optional, but good for tracking)
    if ((error as any).message !== "INSUFFICIENT_CREDITS") {
      try {
        const project = await prisma.project.findUnique({
          where: {
            id: fileData.projectId,
          },
        });

        if (project) {
          await prisma.export.create({
            data: {
              user_id: userId,
              project_id: project.id,
              file_name: `${project.title}.pdf`,
              file_size: 0,
              file_type: "pdf",
              download_url: "",
              status: "failed",
            },
          });
        }
      } catch (dbError) {
        logger.error("Error storing failed export record", { dbError });
      }
    }

    throw error;
  }
}


// Generate DOCX export
async function generateDOCXExport(fileData: any, userId: string) {
  try {
    // Validate user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    let project;
    // Check if we have project data directly or need to fetch from DB
    if (fileData.id) {
      // Project data provided directly from editor
      project = {
        id: fileData.id,
        title: fileData.title,
        content: fileData.content,
        user_id: userId,
        // Accept filtered citations from frontend if available
        citations: fileData.citations // Now accepting pre-filtered citations from frontend
      };
    } else {
      // Fetch project from DB by ID
      project = await prisma.project.findUnique({
        where: {
          id: fileData.projectId,
          user_id: userId,
        },
      });

      if (!project) {
        throw new Error("Project not found or access denied");
      }
    }

    // Generate DOCX using ExportService
    // Normalize content (resolve images, fix tables)
    const { ContentNormalizer } = await import("../../services/contentNormalizer");
    const normalizedContent = await ContentNormalizer.normalizeContent(project.content);

    const exportResult = await ExportService.exportProject(
      project.id,
      userId,
      {
        format: "docx",
        contentOverride: normalizedContent,
        includeCitations: fileData.includeCitations ?? true,
        includeComments: fileData.includeComments ?? false,
        citationStyle: fileData.citationStyle || "apa",
        journalTemplate: fileData.journalTemplate || "",
        journalReady: !!fileData.journalTemplate,
        metadata: {
          author: fileData.metadata?.author || user.full_name || "Unknown Author",
          institution: fileData.metadata?.institution,
          course: fileData.metadata?.course,
          instructor: fileData.metadata?.instructor,
          runningHead: fileData.metadata?.runningHead,
          abstract: fileData.metadata?.abstract,
        },
        // Pass citation policy and violations for annotation
        citationPolicy: fileData.citationPolicy
      }
    );

    // Upload the file to Supabase Storage
    const { SupabaseStorageService } =
      await import("../../services/supabaseStorageService");

    // Upload file
    const uploadResult = await SupabaseStorageService.uploadFile(
      exportResult.buffer,
      `${project.title}.docx`,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      userId,
      {
        userId,
        fileName: `${project.title}.docx`,
        fileType: "docx",
        fileSize: exportResult.fileSize,
        projectId: fileData.projectId,
        createdAt: new Date(),
      }
    );

    // Sanitize filename for download
    const sanitizedTitle = project.title.replace(/[^a-zA-Z0-9-_]/g, "_");

    // Generate a signed URL for secure download (valid for 1 hour)
    const downloadUrl = await SupabaseStorageService.createSignedUrl(
      uploadResult.path,
      3600, // 1 hour expiration
      { download: `${sanitizedTitle}.docx` } // Force download with correct filename
    );

    // Store export record in database
    await prisma.export.create({
      data: {
        user_id: userId,
        project_id: project.id,
        file_name: `${project.title}.docx`,
        file_size: exportResult.fileSize,
        file_type: "docx",
        download_url: downloadUrl,
        status: "completed",
      },
    });

    logger.info("DOCX export generated successfully", {
      projectId: fileData.projectId,
      userId,
      fileSize: exportResult.fileSize,
    });

    return {
      downloadUrl,
      fileSize: exportResult.fileSize,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error("Error generating DOCX export", { error });

    // Store failed export record in database
    try {
      const project = await prisma.project.findUnique({
        where: {
          id: fileData.projectId,
        },
      });

      if (project) {
        await prisma.export.create({
          data: {
            user_id: userId,
            project_id: project.id,
            file_name: `${project.title}.docx`,
            file_size: 0,
            file_type: "docx",
            download_url: "",
            status: "failed",
          },
        });
      }
    } catch (dbError) {
      logger.error("Error storing failed export record", { dbError });
    }

    throw error;
  }
}


// Generate TXT export
async function generateTXTExport(fileData: any, userId: string) {
  try {
    // Validate user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    let project;
    // Check if we have project data directly or need to fetch from DB
    if (fileData.id) {
      // Project data provided directly from editor
      project = {
        id: fileData.id,
        title: fileData.title,
        content: fileData.content,
        user_id: userId,
      };
    } else {
      // Fetch project from DB by ID
      project = await prisma.project.findUnique({
        where: {
          id: fileData.projectId,
          user_id: userId,
        },
      });

      if (!project) {
        throw new Error("Project not found or access denied");
      }
    }

    // Generate TXT using ExportService
    // Normalize content for TXT as well (though less critical, good for consistency)
    const { ContentNormalizer } = await import("../../services/contentNormalizer");
    const normalizedContent = await ContentNormalizer.normalizeContent(project.content);

    const exportResult = await ExportService.exportProject(
      project.id,
      userId,
      {
        format: "txt",
        contentOverride: normalizedContent,
        includeCitations: fileData.includeCitations ?? true,
        citationStyle: fileData.citationStyle || "apa",
        journalTemplate: fileData.journalTemplate || "",
        journalReady: !!fileData.journalTemplate,
        metadata: {
          author: fileData.metadata?.author || user.full_name || "Unknown Author",
          institution: fileData.metadata?.institution,
          course: fileData.metadata?.course,
          instructor: fileData.metadata?.instructor,
          runningHead: fileData.metadata?.runningHead,
          abstract: fileData.metadata?.abstract,
        },
      }
    );

    // Upload the file to Supabase Storage
    const { SupabaseStorageService } =
      await import("../../services/supabaseStorageService");

    // Upload file
    const uploadResult = await SupabaseStorageService.uploadFile(
      exportResult.buffer,
      `${project.title}.txt`,
      "text/plain",
      userId,
      {
        userId,
        fileName: `${project.title}.txt`,
        fileType: "txt",
        fileSize: exportResult.fileSize,
        projectId: fileData.projectId,
        createdAt: new Date(),
      }
    );

    // Sanitize filename for download
    const sanitizedTitle = project.title.replace(/[^a-zA-Z0-9-_]/g, "_");

    // Generate a signed URL for secure download
    const downloadUrl = await SupabaseStorageService.createSignedUrl(
      uploadResult.path,
      3600,
      { download: `${sanitizedTitle}.txt` }
    );

    // Store export record in database
    await prisma.export.create({
      data: {
        user_id: userId,
        project_id: project.id,
        file_name: `${project.title}.txt`,
        file_size: exportResult.fileSize,
        file_type: "txt",
        download_url: downloadUrl,
        status: "completed",
      },
    });

    logger.info("TXT export generated successfully", {
      projectId: fileData.projectId,
      userId,
      fileSize: exportResult.fileSize,
    });

    return {
      downloadUrl,
      fileSize: exportResult.fileSize,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error("Error generating TXT export", { error });

    // Store failed export record in database
    try {
      const project = await prisma.project.findUnique({
        where: {
          id: fileData.projectId,
        },
      });

      if (project) {
        await prisma.export.create({
          data: {
            user_id: userId,
            project_id: project.id,
            file_name: `${project.title}.txt`,
            file_size: 0,
            file_type: "txt",
            download_url: "",
            status: "failed",
          },
        });
      }
    } catch (dbError) {
      logger.error("Error storing failed export record", { dbError });
    }

    throw error;
  }
}

// Generate LaTeX export
async function generateLaTeXExport(fileData: any, userId: string) {
  try {
    // Validate user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    let project;
    // Check if we have project data directly or need to fetch from DB
    if (fileData.id) {
      // Project data provided directly from editor
      project = {
        id: fileData.id,
        title: fileData.title,
        content: fileData.content,
        user_id: userId,
      };
    } else {
      // Fetch project from DB by ID
      project = await prisma.project.findUnique({
        where: {
          id: fileData.projectId,
          user_id: userId,
        },
      });

      if (!project) {
        throw new Error("Project not found or access denied");
      }
    }

    // Generate LaTeX using ExportService
    const normalizedContent = await ContentNormalizer.normalizeContent(project.content);

    const exportResult = await ExportService.exportProject(
      project.id,
      userId,
      {
        format: "latex",
        contentOverride: normalizedContent,
        includeCitations: fileData.includeCitations ?? true,
        citationStyle: fileData.citationStyle || "apa",
        journalTemplate: fileData.journalTemplate || "",
        journalReady: !!fileData.journalTemplate,
        metadata: {
          author: fileData.metadata?.author || user.full_name || "Unknown Author",
          institution: fileData.metadata?.institution,
          course: fileData.metadata?.course,
          instructor: fileData.metadata?.instructor,
          runningHead: fileData.metadata?.runningHead,
          abstract: fileData.metadata?.abstract,
        },
      }
    );

    // Upload the file to Supabase Storage
    const { SupabaseStorageService } =
      await import("../../services/supabaseStorageService");

    // Upload file
    const uploadResult = await SupabaseStorageService.uploadFile(
      exportResult.buffer,
      `${project.title}.tex`,
      "text/plain",
      userId,
      {
        userId,
        fileName: `${project.title}.tex`,
        fileType: "tex",
        fileSize: exportResult.fileSize,
        projectId: fileData.projectId,
        createdAt: new Date(),
      }
    );

    // Sanitize filename for download
    const sanitizedTitle = project.title.replace(/[^a-zA-Z0-9-_]/g, "_");

    // Generate a signed URL for secure download
    const downloadUrl = await SupabaseStorageService.createSignedUrl(
      uploadResult.path,
      3600,
      { download: `${sanitizedTitle}.tex` }
    );

    // Store export record in database
    await prisma.export.create({
      data: {
        user_id: userId,
        project_id: project.id,
        file_name: `${project.title}.tex`,
        file_size: exportResult.fileSize,
        file_type: "tex",
        download_url: downloadUrl,
        status: "completed",
      },
    });

    logger.info("LaTeX export generated successfully", {
      projectId: fileData.projectId,
      userId,
      fileSize: exportResult.fileSize,
    });

    return {
      downloadUrl,
      fileSize: exportResult.fileSize,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error("Error generating LaTeX export", { error });

    // Store failed export record in database
    try {
      const project = await prisma.project.findUnique({
        where: {
          id: fileData.projectId,
        },
      });

      if (project) {
        await prisma.export.create({
          data: {
            user_id: userId,
            project_id: project.id,
            file_name: `${project.title}.tex`,
            file_size: 0,
            file_type: "tex",
            download_url: "",
            status: "failed",
          },
        });
      }
    } catch (dbError) {
      logger.error("Error storing failed export record", { dbError });
    }

    throw error;
  }
}

// Generate RTF export
async function generateRTFExport(fileData: any, userId: string) {
  try {
    // Validate user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    let project;
    // Check if we have project data directly or need to fetch from DB
    if (fileData.id) {
      // Project data provided directly from editor
      project = {
        id: fileData.id,
        title: fileData.title,
        content: fileData.content,
        user_id: userId,
      };
    } else {
      // Fetch project from DB by ID
      project = await prisma.project.findUnique({
        where: {
          id: fileData.projectId,
          user_id: userId,
        },
      });

      if (!project) {
        throw new Error("Project not found or access denied");
      }
    }

    const { ContentNormalizer } = await import("../../services/contentNormalizer");
    const normalizedContent = await ContentNormalizer.normalizeContent(project.content);

    const exportResult = await ExportService.exportProject(
      project.id,
      userId,
      {
        format: "rtf",
        contentOverride: normalizedContent,
        includeCitations: fileData.includeCitations ?? true,
        citationStyle: fileData.citationStyle || "apa",
        journalTemplate: fileData.journalTemplate || "",
        journalReady: !!fileData.journalTemplate,
        metadata: {
          author: fileData.metadata?.author || user.full_name || "Unknown Author",
          institution: fileData.metadata?.institution,
          course: fileData.metadata?.course,
          instructor: fileData.metadata?.instructor,
          runningHead: fileData.metadata?.runningHead,
          abstract: fileData.metadata?.abstract,
        },
      }
    );

    // Upload the file to Supabase Storage
    const { SupabaseStorageService } =
      await import("../../services/supabaseStorageService");

    // Upload file
    const uploadResult = await SupabaseStorageService.uploadFile(
      exportResult.buffer,
      `${project.title}.rtf`,
      "text/rtf", // Use text/rtf to bypass Supabase mime type restriction
      userId,
      {
        userId,
        fileName: `${project.title}.rtf`,
        fileType: "rtf",
        fileSize: exportResult.fileSize,
        projectId: fileData.projectId,
        createdAt: new Date(),
      }
    );

    // Sanitize filename for download
    const sanitizedTitle = project.title.replace(/[^a-zA-Z0-9-_]/g, "_");

    // Generate a signed URL for secure download
    const downloadUrl = await SupabaseStorageService.createSignedUrl(
      uploadResult.path,
      3600,
      { download: `${sanitizedTitle}.rtf` }
    );

    // Store export record in database
    await prisma.export.create({
      data: {
        user_id: userId,
        project_id: project.id,
        file_name: `${project.title}.rtf`,
        file_size: exportResult.fileSize,
        file_type: "rtf",
        download_url: downloadUrl,
        status: "completed",
      },
    });

    logger.info("RTF export generated successfully", {
      projectId: fileData.projectId,
      userId,
      fileSize: exportResult.fileSize,
    });

    return {
      downloadUrl,
      fileSize: exportResult.fileSize,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error("Error generating RTF export", { error });

    // Store failed export record in database
    try {
      if (fileData.projectId) {
        const project = await prisma.project.findUnique({
          where: {
            id: fileData.projectId,
          },
        });

        if (project) {
          await prisma.export.create({
            data: {
              user_id: userId,
              project_id: project.id,
              file_name: `${project.title}.rtf`,
              file_size: 0,
              file_type: "rtf",
              download_url: "",
              status: "failed",
            },
          });
        }
      }
    } catch (dbError) {
      logger.error("Error storing failed export record", { dbError });
    }

    throw error;
  }
}

// Export config for serverless function
export const config = {
  runtime: "nodejs18.x",
};
