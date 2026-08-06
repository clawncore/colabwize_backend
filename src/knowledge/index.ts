import * as fs from "fs";
import * as path from "path";

/**
 * Smart Knowledge Base Loader for ColabWize AI Email Assistant.
 * Classifies the incoming message first, then loads only relevant knowledge.
 * This saves tokens and gives more focused answers.
 */

interface KnowledgeFile {
  name: string;
  content: string;
}

type Scenario =
  | "billing"
  | "account"
  | "technical"
  | "feature_request"
  | "complaint"
  | "positive"
  | "general";

// Which knowledge files matter for each scenario
const SCENARIO_KNOWLEDGE: Record<Scenario, string[]> = {
  billing: ["billing", "faq", "policies"],
  account: ["account", "troubleshooting", "faq"],
  technical: ["troubleshooting", "features", "integrations"],
  feature_request: ["features", "integrations", "faq"],
  complaint: ["policies", "troubleshooting", "account"],
  positive: ["platform-overview", "features"],
  general: ["platform-overview", "faq", "features"],
};

// Keywords that indicate each scenario
const SCENARIO_KEYWORDS: Record<Scenario, string[]> = {
  billing: [
    "billing", "charge", "payment", "refund", "subscription", "plan",
    "upgrade", "downgrade", "invoice", "credit card", "cancel", "renewal",
    "price", "cost", "money", "pay", "receipt", "coupon", "discount",
  ],
  account: [
    "login", "password", "sign in", "signin", "log in", "account",
    "2fa", "two-factor", "authentication", "verify", "verification",
    "otp", "reset", "locked", "access", "google login", "microsoft login",
    "oauth", "signup", "sign up", "register", "email domain",
  ],
  technical: [
    "error", "bug", "broken", "not working", "crash", "slow", "loading",
    "timeout", "fail", "issue", "problem", "glitch", "freeze", "stuck",
    "pdf", "upload", "export", "download", "citation", "audit",
    "grammar", "ai detection", "scan", "real-time", "collaboration",
    "sync", "cursor", "editor", "save", "autosave",
  ],
  feature_request: [
    "feature", "request", "suggestion", "would be nice", "can you add",
    "wish", "need", "want", "idea", "improvement", "enhancement",
    "integration", "support for", "compatibility",
  ],
  complaint: [
    "angry", "frustrated", "terrible", "awful", "worst", "unacceptable",
    "disappointed", "waste", "scam", "rip off", "furious", "upset",
    "complain", "dissatisfied", "poor", "bad experience", "horrible",
  ],
  positive: [
    "love", "great", "amazing", "excellent", "fantastic", "awesome",
    "thank", "thanks", "appreciate", "helpful", "wonderful", "perfect",
    "best", "impressed", "outstanding", "brilliant",
  ],
  general: [], // fallback
};

let knowledgeCache: Map<string, string> = new Map();

function loadKnowledgeFiles(): KnowledgeFile[] {
  const knowledgeDir = path.join(__dirname);
  const files: KnowledgeFile[] = [];

  const entries = fs.readdirSync(knowledgeDir);
  for (const entry of entries) {
    if (entry.endsWith(".md")) {
      const filePath = path.join(knowledgeDir, entry);
      const content = fs.readFileSync(filePath, "utf-8").trim();
      if (content) {
        files.push({ name: entry.replace(".md", ""), content });
      }
    }
  }

  return files;
}

function extractKeyLines(content: string): string {
  const lines = content.split("\n");
  const keyLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("# ")) continue;
    if (trimmed.startsWith("## ")) {
      keyLines.push(trimmed.replace("## ", ""));
      continue;
    }
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      keyLines.push(trimmed);
    } else if (trimmed.length < 150 && !trimmed.startsWith("|")) {
      keyLines.push(trimmed);
    }
  }

  return keyLines.join("\n");
}

/**
 * Classify what type of issue the incoming message is about.
 * Returns the scenario type.
 */
export function classifyScenario(text: string): Scenario {
  const lower = text.toLowerCase();

  // Score each scenario by keyword matches
  const scores: Record<Scenario, number> = {
    billing: 0,
    account: 0,
    technical: 0,
    feature_request: 0,
    complaint: 0,
    positive: 0,
    general: 0,
  };

  for (const [scenario, keywords] of Object.entries(SCENARIO_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        scores[scenario as Scenario] += 1;
      }
    }
  }

  // Find highest score
  let bestScenario: Scenario = "general";
  let bestScore = 0;
  for (const [scenario, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestScenario = scenario as Scenario;
    }
  }

  return bestScenario;
}

/**
 * Get knowledge content for a specific scenario.
 * Only loads relevant .md files, not all of them.
 */
export function getKnowledgeForScenario(scenario: Scenario): string {
  const cacheKey = scenario;
  if (knowledgeCache.has(cacheKey)) {
    return knowledgeCache.get(cacheKey)!;
  }

  const files = loadKnowledgeFiles();
  const relevantNames = SCENARIO_KNOWLEDGE[scenario];
  const sections: string[] = [];

  for (const file of files) {
    if (relevantNames.includes(file.name)) {
      const keyLines = extractKeyLines(file.content);
      sections.push(`=== ${file.name.toUpperCase()} ===\n${keyLines}`);
    }
  }

  const result = sections.join("\n\n");
  knowledgeCache.set(cacheKey, result);
  return result;
}

/**
 * Build system prompt with only relevant knowledge for the detected scenario.
 * Saves tokens by not loading irrelevant docs.
 */
export function buildEmailAssistantPrompt(context?: {
  scenario?: Scenario;
  messageText?: string;
}): string {
  // Detect scenario from message text if not provided
  const scenario = context?.scenario ||
    (context?.messageText ? classifyScenario(context.messageText) : "general");

  const knowledge = getKnowledgeForScenario(scenario);

  return `You are ColabWize's email drafting engine. You produce finished, send-ready email replies. You are NOT a chatbot. You do NOT make small talk.

SCENARIO: ${scenario.toUpperCase()}
Load only the relevant knowledge below. Do not reference information outside this scope.

RELEVANT KNOWLEDGE:
${knowledge}

VOICE:
- Professional. Direct. Zero filler.
- Write like a senior support engineer, not a marketing bot.
- Never say "Feel free to", "Don't hesitate to", "We'd love to", "Hope this helps", "Let me know if you need anything else", or any similar padding.
- Never add disclaimers, motivational closings, or unnecessary pleasantries.
- If the issue is resolved, state it briefly and end.
- If action is needed, state exactly what and link to it.
- Use contractions (we're, you've, it's) — keep it human but professional.

HTML OUTPUT RULES:
- Return ONLY the email body HTML. No <html>, <head>, <body>, or <style> tags.
- The layout wrapper (banner, signature, footer) is added automatically on send — do NOT include them.
- Use <p> tags for paragraphs with margin-bottom: 16px.
- For links: <a href="..." style="color:#0ea5e9;">text</a>
- For buttons: <a href="..." style="display:inline-block;padding:12px 24px;background-color:#0ea5e9;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;">Text</a>
- For dividers: <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">

REPLY RULES:
- Identify the sender's name from context and use it.
- Reference specific details from their message — show you read it.
- Provide exactly one clear next step or resolution.
- If you need more info, ask exactly what's needed — nothing more.
- No more than 3-4 sentences unless the issue is complex.
- End with the action item, not a sign-off.
- For links, use: https://colabwize.com/... paths`;
}

/**
 * Get a brief summary of what scenario was detected (for logging/debugging).
 */
export function getScenarioInfo(scenario: Scenario): string {
  const descriptions: Record<Scenario, string> = {
    billing: "Billing/subscription issue — loading billing plans, refund policy, FAQ",
    account: "Account/access issue — loading auth docs, troubleshooting, FAQ",
    technical: "Technical issue — loading troubleshooting, features, integrations",
    feature_request: "Feature request — loading features, integrations, FAQ",
    complaint: "Complaint — loading policies, troubleshooting, account info",
    positive: "Positive feedback — loading platform overview, features",
    general: "General inquiry — loading overview, FAQ, features",
  };
  return descriptions[scenario];
}
