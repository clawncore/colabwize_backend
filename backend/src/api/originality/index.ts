import express, { Request, Response } from "express";
import { OriginalityMapService } from "../../services/originalityMapService";
import { RephraseService } from "../../services/rephraseService";
import logger from "../../monitoring/logger";
import rateLimit from "express-rate-limit";

import { SubscriptionService } from "../../services/subscriptionService";
import { CreditService } from "../../services/CreditService";
import compareRouter from "./compare";
import enhancedRouter from "./enhanced";
import webhookRouter from "./webhook";
import { prisma } from "../../lib/prisma";
import { EnhancedOriginalityDetectionService } from "../../services/enhancedOriginalityDetectionService";
import { getSafeString } from "../../utils/requestHelpers";
import { BillingGateway, BillingError } from "../../billing/BillingGateway";

const router = express.Router();

router.use("/", compareRouter);

// Enhanced originality detection routes
router.use("/enhanced", enhancedRouter);

// Webhook routes (No rate limit, as they come from Copyleaks)
router.use("/webhook", webhookRouter);

// Rate limiters
const scanLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: "Too many scan requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

const rephraseLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute
  message: "Too many rephrase requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/originality/scan
 * Scan document for originality
 */
router.post(
  "/scan",
  scanLimiter,
  // checkUsageLimit removed - using internal check for variable cost
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const { projectId, content } = req.body as any;

      // Validation
      if (!projectId || !content) {
        return res.status(400).json({
          success: false,
          message: "projectId and content are required",
        });
      }

      if (typeof content !== "string" || content.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Content must be a non-empty string",
        });
      }

      // Get user's plan to determine limits
      const plan = await SubscriptionService.getActivePlan(userId);
      const limits = SubscriptionService.getPlanLimits(plan);
      const limit = limits.max_scan_characters || 100000;

      if (content.length > limit) {
        return res.status(400).json({
          success: false,
          message: `Content too large for your plan (limit: ${limit.toLocaleString()} characters). Please upgrade for higher limits.`,
        });
      }

      const wordCount = content.trim().split(/\s+/).length;
      logger.info("Starting originality scan", { userId, projectId, plan });

      // ── Originality billing/limit gating DISABLED per request (code preserved) ──
      // Run the scan through the single billing pipeline (hold → execute →
      // confirm/release). Replaces the old assertCanUse (which consumed
      // before execution) with the correct lifecycle.
      // try {
      //   const result = await BillingGateway.withFeature(
      //     userId,
      //     "originality_scan",
      //     { wordCount },
      //     () => OriginalityMapService.scanDocument(projectId, userId, content, plan),
      //   );
      //
      //   return res.status(200).json({ success: true, data: result });
      // } catch (e: any) {
      //   if (e instanceof BillingError) {
      //     const status = e.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
      //     return res.status(status).json({
      //       success: false,
      //       message: e.message || "Plan limit reached",
      //       code: e.code,
      //       ...e.data,
      //     });
      //   }
      //   throw e;
      // }

      // Originality scan now runs without billing/quota gating:
      const result = await OriginalityMapService.scanDocument(projectId, userId, content, plan);
      return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      logger.error("Error in scan endpoint", { error: error.message });

      return res.status(500).json({
        success: false,
        message: error.message || "Failed to scan document",
      });
    }
  }
);

/**
 * GET /api/originality/scan/:scanId
 * Get scan results by ID
 */
router.get("/scan/:scanId", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { scanId } = req.params;

    if (!scanId) {
      return res.status(400).json({
        success: false,
        message: "scanId is required",
      });
    }

    const result = await OriginalityMapService.getScanResults(scanId as string, userId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error("Error getting scan results", { error: error.message });

    if (
      error.message.includes("not found") ||
      error.message.includes("access denied")
    ) {
      return res.status(404).json({
        success: false,
        message: "Scan not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get scan results",
    });
  }
});

/**
 * GET /api/originality/history
 * Get all scans for current user
 */
router.get("/history", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const results = await OriginalityMapService.getUserScans(userId);

    return res.status(200).json({
      success: true,
      data: results,
    });
  } catch (error: any) {
    logger.error("Error getting scan history", { error: error.message });

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get scan history",
    });
  }
});

/**
 * GET /api/originality/project/:projectId
 * Get all scans for a project
 */
router.get("/project/:projectId", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { projectId } = req.params;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: "projectId is required",
      });
    }

    const results = await OriginalityMapService.getProjectScans(
      projectId as string,
      userId
    );

    return res.status(200).json({
      success: true,
      data: results,
    });
  } catch (error: any) {
    logger.error("Error getting project scans", { error: error.message });

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get project scans",
    });
  }
});

/**
 * POST /api/originality/rephrase
 * Get rephrase suggestions for flagged text
 */
router.post(
  "/rephrase",
  rephraseLimiter,
  // checkUsageLimit removed - using internal entitlement check
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const { scanId, matchId, originalText } = req.body as any;

      // Validation
      if (!scanId || !matchId || !originalText) {
        return res.status(400).json({
          success: false,
          message: "scanId, matchId, and originalText are required",
        });
      }

      if (
        typeof originalText !== "string" ||
        originalText.trim().length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: "originalText must be a non-empty string",
        });
      }

      logger.info("Generating rephrase suggestions", {
        userId,
        scanId,
        matchId,
      });


      const wordCount = originalText.trim().split(/\s+/).length;

      // Run through the single billing pipeline (hold → execute →
      // confirm/release).
      try {
        const suggestions = await BillingGateway.withFeature(
          userId,
          "rephrase",
          { inputWords: wordCount },
          () => RephraseService.generateRephraseSuggestions(scanId, matchId, originalText, userId),
        );

        return res.status(200).json({ success: true, data: suggestions });
      } catch (e: any) {
        if (e instanceof BillingError) {
          const status = e.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
          return res.status(status).json({
            success: false,
            message: e.message,
            code: e.code,
            ...e.data,
          });
        }
        throw e;
      }
    } catch (error: any) {
      logger.error("Error generating rephrase suggestions", {
        error: error.message,
      });

      if (
        error.message.includes("not found") ||
        error.message.includes("access denied")
      ) {
        return res.status(404).json({
          success: false,
          message: "Scan not found",
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || "Failed to generate rephrase suggestions",
      });
    }
  }
);

/**
 * GET /api/originality/scan/:scanId/suggestions
 * Get all rephrase suggestions for a scan
 */
router.get("/scan/:scanId/suggestions", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { scanId } = req.params;

    if (!scanId) {
      return res.status(400).json({
        success: false,
        message: "scanId is required",
      });
    }

    const suggestions = await RephraseService.getScanSuggestions(
      scanId as string,
      userId
    );

    return res.status(200).json({
      success: true,
      data: suggestions,
    });
  } catch (error: any) {
    logger.error("Error getting scan suggestions", { error: error.message });

    if (
      error.message.includes("not found") ||
      error.message.includes("access denied")
    ) {
      return res.status(404).json({
        success: false,
        message: "Scan not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get scan suggestions",
    });
  }
});

/**
 * POST /api/originality/check-self-plagiarism
 * Check for self-plagiarism against user's recent projects
 */
router.post("/check-self-plagiarism", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { currentContent, currentProjectId } = req.body as any;

    if (!currentContent || !currentProjectId) {
      return res.status(400).json({
        success: false,
        message: "currentContent and currentProjectId are required",
      });
    }

    // Get user's recent projects (excluding current project)
    const recentProjects = await prisma.project.findMany({
      where: {
        user_id: userId,
        id: { not: currentProjectId }, // Exclude current project
        created_at: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        },
      },
      select: {
        id: true,
        title: true,
        content: true,
        created_at: true,
      },
      orderBy: {
        created_at: "desc",
      },
      take: 10, // Get last 10 projects
    });

    // Compare current content against each recent project
    const results = [];
    for (const project of recentProjects) {
      if (project.content) {
        // Only compare if content exists
        const projectContent =
          typeof project.content === "string"
            ? project.content
            : JSON.stringify(project.content);

        const comparison = EnhancedOriginalityDetectionService.compareDrafts(
          currentContent,
          projectContent
        );

        // Only include results with significant similarity
        if (comparison.similarityScore > 20) {
          // Threshold for self-plagiarism
          results.push({
            ...comparison,
            comparedWith: project.title,
            projectId: project.id,
            createdAt: project.created_at,
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: results,
    });
  } catch (error: any) {
    logger.error("Error checking self-plagiarism", { error: error.message });

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to check self-plagiarism",
    });
  }
});

const humanizeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute
  message: "Too many humanize requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/originality/humanize
 * Adversarial Humanization (Auto-Humanizer)
 */
/**
 * POST /api/originality/humanize
 * Adversarial Humanization (Auto-Humanizer)
 */
router.post(
  "/humanize",
  humanizeLimiter,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }

      const { content } = req.body;

      if (!content || typeof content !== 'string' || content.length < 10) {
        return res.status(400).json({ success: false, message: "Valid content is required (min 10 chars)" });
      }

      if (content.length > 5000) {
        return res.status(400).json({ success: false, message: "Content too long (max 5000 chars)" });
      }

      const wordCount = content.split(/\s+/).length;
      logger.info("Starting text humanization", { userId, length: content.length });

      // Import dynamically to avoid circular issues
      const { HumanizerService } = await import("../../services/humanizerService.js");

      // Run through the single billing pipeline (hold → execute →
      // confirm/release).
      try {
        const result = await BillingGateway.withFeature(
          userId,
          "rephrase",
          { inputWords: wordCount },
          () => HumanizerService.humanizeText(content),
        );

        return res.status(200).json({ success: true, data: result });
      } catch (e: any) {
        if (e instanceof BillingError) {
          const status = e.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
          return res.status(status).json({
            success: false,
            message: e.message,
            code: e.code,
            ...e.data,
          });
        }
        throw e;
      }

    } catch (error: any) {
      logger.error("Error in humanize endpoint", { error: error.message });

      const isTimeout = error.message?.includes("timeout") || error.name === "TimeoutError";
      if (isTimeout) {
        return res.status(403).json({
          error: "Generation timed out due to high demand.",
          code: "PLAN_LIMIT_REACHED",
          data: { upgrade_url: "/pricing" }
        });
      }

      return res.status(500).json({ success: false, message: "Failed to humanize text", code: "GENERATION_FAILED" });
    }
  }
);

/**
 * POST /api/originality/section-check
 * Lightweight check for specific section. Metered under scan quota so the
 * analysis pipeline isn't an ungated free surface.
 */
router.post(
  "/section-check",
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { projectId, content } = req.body;

      if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
      if (!content || !projectId) return res.status(400).json({ success: false, message: "Missing info" });

      const wordCount = typeof content === "string" ? content.trim().split(/\s+/).length : 0;

      // ── Originality billing disabled per request (code preserved) ──
      // const result = await BillingGateway.withFeature(
      //   userId,
      //   "originality_scan",
      //   { wordCount },
      //   () => OriginalityMapService.checkSectionRisk(projectId, userId, content),
      // );
      const result = await OriginalityMapService.checkSectionRisk(projectId, userId, content);
      return res.status(200).json({ success: true, data: result });
    } catch (e: any) {
      if (e instanceof BillingError) {
        const status = e.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
        return res.status(status).json({ success: false, message: e.message, code: e.code, ...e.data });
      }
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

/**
 * POST /api/originality/rewrite-selection
 * Humanize specific selection
 */
router.post(
  "/rewrite-selection",
  humanizeLimiter,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }

      const { selection, context } = req.body;
      if (!selection) return res.status(400).json({ success: false, message: "Selection required" });

      const wordCount = selection.split(/\s+/).length;

      // Dynamic import to handle circular deps if any
      const { HumanizerService } = await import("../../services/humanizerService.js");

      // Run through the single billing pipeline (hold → execute →
      // confirm/release).
      try {
        const result = await BillingGateway.withFeature(
          userId,
          "rephrase",
          { inputWords: wordCount },
          () => HumanizerService.rewriteSelection(selection, context),
        );

        return res.status(200).json({ success: true, data: result });
      } catch (e: any) {
        if (e instanceof BillingError) {
          const status = e.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
          return res.status(status).json({
            success: false,
            message: e.message,
            code: e.code,
            ...e.data,
          });
        }
        throw e;
      }
    } catch (e: any) {
      const isTimeout = e.message?.includes("timeout") || e.name === "TimeoutError";
      if (isTimeout) {
        return res.status(403).json({
          error: "Generation timed out. Please try again.",
          code: "PLAN_LIMIT_REACHED",
          data: { upgrade_url: "/pricing" }
        });
      }
      return res.status(500).json({ success: false, message: e.message, code: "GENERATION_FAILED" });
    }
  }
);

/**
 * POST /api/originality/explain-risk
 * PROMPT 4: Explain academic risk
 */
router.post(
  "/explain-risk",
  scanLimiter,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });

      const { matchText, sourceText, riskLevel } = req.body;
      if (!matchText || !sourceText) return res.status(400).json({ success: false, message: "Missing text to explain" });

      // Gated behind scan entitlement — it is an AI call that must verify the
      // user has originality_scan quota. Consumes one scan unit (same as a
      // regular scan) since it invokes the AI pipeline.
      // ── Originality billing disabled per request (code preserved) ──
      // const Explanation = await BillingGateway.withFeature(
      //   userId,
      //   "originality_scan",
      //   undefined,
      //   () => EnhancedOriginalityDetectionService.explainRiskWithAI(matchText, sourceText, riskLevel || "Moderate"),
      // );
      const Explanation = await EnhancedOriginalityDetectionService.explainRiskWithAI(matchText, sourceText, riskLevel || "Moderate");

      return res.status(200).json({ success: true, data: { explanation: Explanation } });
    } catch (e: any) {
      if (e instanceof BillingError) {
        const status = e.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
        return res.status(status).json({ success: false, message: e.message, code: e.code, ...e.data });
      }
      logger.error("Error explaining risk", { error: e.message });
      return res.status(500).json({ success: false, message: "Failed to generate explanation" });
    }
  }
);

export default router;
