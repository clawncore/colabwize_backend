import express from "express";
import { CopyscapeService } from "../../services/copyscapeService";
import { DraftComparisonService } from "../../services/draftComparisonService";
import logger from "../../monitoring/logger";
import rateLimit from "express-rate-limit";

const router = express.Router();

const demoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: "Too many demo requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

const MAX_WORDS = 1500;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function analyzeCitationsDemo(text: string) {
  const citations: { text: string; type: string }[] = [];
  const issues: { type: "warning" | "error" | "info"; message: string }[] = [];
  let style = "Unknown";

  const authorYearPatterns = [
    /\([A-Z][a-zA-Z'’.-]+(?:\s+et\s+al\.?)?[,\s]+\d{4}[a-z]?\)/g,
    /[A-Z][a-z]+(?:\s+et\s+al\.?)?\s*\(\d{4}\)/g,
    /\([A-Z][a-zA-Z'’.-]+\s+(?:&\s*)?[A-Z][a-zA-Z'’.-]+[,\s]+\d{4}\)/g,
  ];

  const numericPattern = /\[\d+(?:[,\s]+\d+)*\]/g;

  const hasAuthorYear = authorYearPatterns.some(p => { p.lastIndex = 0; return p.test(text); });
  const hasNumeric = numericPattern.test(text);

  if (hasAuthorYear && hasNumeric) style = "Mixed";
  else if (hasAuthorYear) style = "APA";
  else if (hasNumeric) style = "IEEE";

  const refSectionMatch = text.match(/(?:^|\n)\s*(?:references|bibliography|works cited)\s*\n/i);
  let refEntries: string[] = [];
  if (refSectionMatch) {
    const refSection = text.slice(refSectionMatch.index! + refSectionMatch[0].length);
    refEntries = refSection
      .split(/\n/)
      .map(l => l.trim())
      .filter(l => l.length > 15 && !l.match(/^\s*(?:references|bibliography|works cited)\s*$/i) && !l.startsWith("http"));
  }

  for (const p of authorYearPatterns) {
    p.lastIndex = 0;
    let m;
    while ((m = p.exec(text)) !== null) {
      citations.push({ text: m[0], type: "author-year" });
    }
  }
  (numericPattern as RegExp).lastIndex = 0;
  let m;
  while ((m = numericPattern.exec(text)) !== null) {
    citations.push({ text: m[0], type: "numeric" });
  }

  const inTextCount = citations.length;
  const refCount = refEntries.length;

  if (inTextCount === 0 && refCount === 0) {
    issues.push({ type: "info", message: "No citations or references detected." });
  } else {
    if (inTextCount === 0) issues.push({ type: "warning", message: "No in-text citations found." });
    if (refCount === 0) issues.push({ type: "warning", message: "No reference list detected." });
    if (inTextCount > 0 && refCount === 0) issues.push({ type: "error", message: `Found ${inTextCount} in-text citations but no reference list.` });
    if (inTextCount > 0 && refCount > 0 && Math.abs(inTextCount - refCount) > 3) {
      issues.push({ type: "warning", message: `Mismatch: ${inTextCount} in-text citations vs ${refCount} references.` });
    }
  }

  if (style === "Unknown") issues.push({ type: "info", message: "Citation style not detected." });

  const score = inTextCount === 0 && refCount === 0 ? 0
    : Math.min(100, Math.round(
        (refCount > 0 ? 30 : 0) +
        (inTextCount > 0 ? 20 : 0) +
        (style !== "Unknown" ? 15 : 0) +
        (issues.filter(i => i.type !== "error").length === 0 ? 15 : 0) +
        (inTextCount > 0 && refCount > 0 && Math.abs(inTextCount - refCount) <= 3 ? 20 : 0)
      ));

  return { inTextCount, refCount, style, issues, score, citations, refEntries };
}

router.post("/plagiarism-check", demoLimiter, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ success: false, message: "Content is required" });
    }
    if (wordCount(content) > MAX_WORDS) {
      return res.status(400).json({ success: false, message: `Content exceeds ${MAX_WORDS} word limit` });
    }
    const result = await CopyscapeService.scanText(content);
    return res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error("Demo plagiarism check failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/citation-audit", demoLimiter, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ success: false, message: "Content is required" });
    }
    if (wordCount(content) > MAX_WORDS) {
      return res.status(400).json({ success: false, message: `Content exceeds ${MAX_WORDS} word limit` });
    }
    const result = analyzeCitationsDemo(content);
    return res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error("Demo citation audit failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/draft-compare", demoLimiter, async (req, res) => {
  try {
    const { currentDraft, previousDraft } = req.body;
    if (!currentDraft || typeof currentDraft !== "string" || currentDraft.trim().length === 0) {
      return res.status(400).json({ success: false, message: "Current draft content is required" });
    }
    if (!previousDraft || typeof previousDraft !== "string" || previousDraft.trim().length === 0) {
      return res.status(400).json({ success: false, message: "Previous draft content is required" });
    }
    if (wordCount(currentDraft) > MAX_WORDS || wordCount(previousDraft) > MAX_WORDS) {
      return res.status(400).json({ success: false, message: `Each draft exceeds ${MAX_WORDS} word limit` });
    }
    const result = await DraftComparisonService.compareDrafts(currentDraft, previousDraft);
    return res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error("Demo draft comparison failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
