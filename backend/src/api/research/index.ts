import express, { Request, Response } from "express";
import { initializePrisma } from "../../lib/prisma-async";
import logger from "../../monitoring/logger";
import { PaperDiscoveryService } from "../../services/paperDiscoveryService";
import { OpenAIService } from "../../services/openaiService";

const router = express.Router();

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

/**
 * GET /api/research/topics/recent
 * Get recent research topics for the authenticated user
 */
router.get("/topics/recent", async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const limit = parseInt(req.query.limit as string) || 10;
    const prisma = await initializePrisma();

    // @ts-ignore - ResearchTopic might not be in types yet if generate failed
    const topics = await prisma.researchTopic.findMany({
      where: { user_id: userId },
      orderBy: { created_at: "desc" },
      take: limit,
    });

    return res.json({
      success: true,
      data: topics.map((t: any) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        sources: t.sources,
        sourcesData: t.sources_data,
        lastUpdated: t.updated_at.toISOString().split("T")[0],
      })),
    });
  } catch (error: any) {
    logger.error("Failed to fetch research topics", { error: error.message });
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * POST /api/research/topics
 * Save a new research topic
 */
router.post("/topics", async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { title, description, sources, sourcesData } = req.body;
    const prisma = await initializePrisma();

    // @ts-ignore
    const topic = await prisma.researchTopic.create({
      data: {
        user_id: userId,
        title,
        description,
        sources: sources || 0,
        sources_data: sourcesData || [],
      },
    });

    return res.status(201).json({
      success: true,
      data: {
        id: topic.id,
        title: topic.title,
        description: topic.description,
        sources: topic.sources,
        sourcesData: topic.sources_data,
        lastUpdated: topic.updated_at.toISOString().split("T")[0],
      },
    });
  } catch (error: any) {
    logger.error("Failed to save research topic", { error: error.message });
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * DELETE /api/research/topics/:id
 * Delete a research topic
 */
router.delete("/topics/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    const prisma = await initializePrisma();

    // @ts-ignore
    await prisma.researchTopic.deleteMany({
      where: {
        id: String(id), // Explicitly cast to string to satisfy type checker
        user_id: userId,
      },
    });

    return res.json({ success: false, message: "Topic deleted" });
  } catch (error: any) {
    logger.error("Failed to delete research topic", { error: error.message });
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * POST /api/research/chat-project
 * Chat with a specific project using vectorized content
 */
router.post("/chat-project", async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { message, projectId, history = [] } = req.body;

    if (!message || !projectId) {
      return res
        .status(400)
        .json({ error: "Missing required fields: message, projectId" });
    }

    const prisma = await initializePrisma();

    // Verify project ownership
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        user_id: userId,
      },
      select: {
        id: true,
        title: true,
        content: true,
      },
    });

    if (!project) {
      return res
        .status(404)
        .json({ error: "Project not found or access denied" });
    }

    // Import services dynamically to avoid circular dependencies
    const { VectorStoreService } =
      await import("../../services/vectorStoreService.js");
    const { ChatOpenAI } = await import("@langchain/openai");
    const { SecretsService } = await import("../../services/secrets-service.js");

    // Search for relevant context in project — wrap in try/catch
    // because the vector collection may not exist yet for this project
    let relevantDocs: any[] = [];
    try {
      relevantDocs = await VectorStoreService.searchProjectContext(
        projectId,
        message,
        5, // Top 5 most relevant chunks
      );
    } catch (_vecErr) {
      // Vector store not available / not indexed — fall through to raw fallback
      relevantDocs = [];
    }

    if (relevantDocs.length === 0) {
      // Fallback: extract plain text from the project's Tiptap JSON content
      let fallbackContext = "";
      if (project.content) {
        try {
          const extractText = (node: any): string => {
            if (!node) return "";
            // Handle raw array (top-level content array without doc wrapper)
            if (Array.isArray(node)) {
              return node.map(extractText).join("\n");
            }
            if (node.type === "text") return node.text || "";
            if (Array.isArray(node.content)) {
              const sep =
                node.type === "paragraph" || node.type === "heading"
                  ? "\n"
                  : " ";
              return node.content.map(extractText).join(sep);
            }
            return "";
          };
          fallbackContext = extractText(project.content as any).trim();
        } catch (_) {
          /* ignore */
        }
      }

      if (!fallbackContext) {
        return res.status(200).json({
          answer:
            "I don't have enough context from this project to answer your question. The project might be empty or not indexed yet.",
        });
      }

      // Truncate to ~12k chars (roughly 3000 tokens) to fit within limits
      const truncated =
        fallbackContext.length > 12000
          ? fallbackContext.slice(0, 12000) + "..."
          : fallbackContext;

      const { ChatOpenAI } = await import("@langchain/openai");
      const { SecretsService } = await import("../../services/secrets-service.js");
      const apiKey = await SecretsService.getOpenAiApiKey();
      if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

      const conversationHistory = history
        .map(
          (msg: any) =>
            `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`,
        )
        .join("\n");

      const fallbackPrompt = `You are a helpful assistant answering questions about a project titled "${project.title}".

Here is the project content:
${truncated}

${conversationHistory ? `Previous conversation:\n${conversationHistory}\n` : ""}
User question: ${message}

Please answer based on the provided content. If the content doesn't contain enough information, say so clearly.`;

      const model = new ChatOpenAI({
        openAIApiKey: apiKey,
        modelName: "gpt-4o-mini",
        temperature: 0.7,
      });
      const fallbackResponse = await model.invoke(fallbackPrompt);
      return res.json({ answer: fallbackResponse.content as string });
    }

    // Build context from relevant documents
    const context = relevantDocs
      .map((doc: any, idx: number) => `[${idx + 1}] ${doc.pageContent}`)
      .join("\n\n");

    // Build conversation history
    const conversationHistory = history
      .map(
        (msg: any) =>
          `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`,
      )
      .join("\n");

    // Create prompt for LLM
    const prompt = `You are a helpful assistant answering questions about a project titled "${project.title}".

Context from the project:
${context}

${conversationHistory ? `Previous conversation:\n${conversationHistory}\n` : ""}
User question: ${message}

Please answer based on the provided context. If the context doesn't contain enough information to answer the question, say so clearly.`;

    // Get OpenAI API key
    const apiKey = await SecretsService.getOpenAiApiKey();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    // Create chat model
    const model = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: "gpt-4o-mini",
      temperature: 0.7,
    });

    // Generate response
    const response = await model.invoke(prompt);
    const answer = response.content as string;

    return res.json({ answer });
  } catch (error: any) {
    logger.error("Failed to process project chat", { error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/research/library
 * Get user's saved papers
 */
router.get("/library", async (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user || !user.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const library = await PaperDiscoveryService.getUserLibrary(user.id);
    return res.json({ success: true, data: library });
  } catch (error: any) {
    logger.error("Failed to fetch research library", { error: error.message });
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * POST /api/research/library/save
 * Save a paper to the library
 */
router.post("/library/save", async (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user || !user.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { paper, notes } = req.body;
    if (!paper || (!paper.externalId && !paper.paperId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid paper data" });
    }

    // Ensure externalId is present (PaperDiscoveryService expects it)
    const paperToSave = {
      ...paper,
      externalId: paper.externalId || paper.paperId,
    };

    const saved = await PaperDiscoveryService.savePaperToLibrary(
      user.id,
      paperToSave,
      notes,
    );
    return res.json({ success: true, data: saved });
  } catch (error: any) {
    logger.error("Failed to save paper to library", { error: error.message });
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * DELETE /api/research/library/:paperId
 * Remove a paper from the library
 */
router.delete("/library/:paperId", async (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user || !user.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { paperId } = req.params;
    await PaperDiscoveryService.removePaperFromLibrary(user.id, paperId as string);
    return res.json({ success: true, message: "Paper removed" });
  } catch (error: any) {
    logger.error("Failed to remove paper from library", {
      error: error.message,
    });
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /api/research/:paperId
 * Get details for a specific paper
 */
router.get("/:paperId", async (req: Request, res: Response) => {
  try {
    const { paperId } = req.params;
    const details = await PaperDiscoveryService.getPaperDetails(paperId as string);

    if (!details) {
      return res
        .status(404)
        .json({ success: false, message: "Paper not found" });
    }

    return res.json({ success: true, data: details });
  } catch (error: any) {
    logger.error("Failed to fetch paper details", { error: error.message });
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * POST /api/research/analyze
 * AI Analysis of research papers
 */
router.post("/analyze", async (req: Request, res: Response) => {
  try {
    const { papers } = req.body;
    if (!papers || !Array.isArray(papers) || papers.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid papers data" });
    }

    const paper = papers[0]; // Analyze the first one for now as per FE usage
    if (!paper.abstract) {
      return res
        .status(400)
        .json({ success: false, message: "Paper has no abstract to analyze" });
    }

    const prompt = `
Analyze the following academic paper abstract.
Identify the Research Gap, Methodology, Main Findings, and Limitations.
Return ONLY a valid JSON object with these keys: "Research Gap", "Methodology", "Main Findings", "Limitations".
Do not include any other text or markdown formatting.

Paper Title: ${paper.title}
Abstract: ${paper.abstract}
`;

    const rawAnalysis = await OpenAIService.generateCompletion(prompt, {
      maxTokens: 1000,
      temperature: 0.3,
    });

    let analysis;
    try {
      // Clean up potential markdown formatting from AI
      const cleanJson = rawAnalysis
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
      analysis = JSON.parse(cleanJson);
    } catch (e) {
      logger.error("Failed to parse AI research analysis JSON", {
        rawAnalysis,
      });
      analysis = {
        "Research Gap": "Analysis failed to parse",
        Methodology: "Analysis failed to parse",
        "Main Findings": "Analysis failed to parse",
        Limitations: "Analysis failed to parse",
      };
    }

    // Wrap in an object keyed by paper externalId to match frontend expectation
    return res.json({
      success: true,
      data: {
        [paper.externalId || paper.id]: analysis,
      },
    });
  } catch (error: any) {
    logger.error("Failed to analyze research paper", { error: error.message });
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

export default router;
