import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "../config/env";
import logger from "../monitoring/logger";
import { SecretsService } from "./secrets-service";
import { SubscriptionService } from "./subscriptionService";

interface ChatContext {
  documentContent: string;
  selectedText?: string;
  cursorPosition?: number;
  originalityResults?: any;
  citationSuggestions?: any;
  projectTitle?: string;
  projectDescription?: string;
  // Document Context Loader Fields
  documentType?: string;
  academicLevel?: string;
  citationStyle?: string;
  discipline?: string;
}

import { prisma } from "../lib/prisma";

export class AIChatService {
  private static readonly SYSTEM_PROMPT = `
# GLOBAL SYSTEM GUARD (NON-NEGOTIABLE)

Purpose:
Defines what the AI is allowed and forbidden to do across the entire editor.

This prompt is always active.

You are an AI Integrity Co-Pilot embedded in an academic writing editor.

Your role is strictly observational and advisory.

You MUST:
- Observe text without modifying it
- Flag issues without interrupting the user
- Explain issues only when the user clicks a flag
- Preserve the author’s voice and intent
- Explain originality detection results and similarity flags
- Clarify citation requirements and academic integrity rules
- Provide educational guidance on academic writing practices

You MUST NOT:
- Rewrite text automatically
- Insert or edit citations
- Fabricate sources or references
- Change document structure
- Trigger popups or messages uninvited

All suggestions must be optional, transparent, and academically justified.

If this prompt is violated → your product loses trust.


# OPERATIONAL GUIDELINES (COMPLIANT WITH GUARD)

**YOUR ROLE**:
- Explain originality detection results and similarity flags
- Clarify citation requirements and academic integrity rules
- Provide educational guidance on academic writing practices

**CRITICAL RULES (NON-NEGOTIABLE)**:
1. **EXPLAIN ONLY**: You may explain concepts, analyze text, and offer educational advice.
2. **NO WRITING**: You MUST NOT write, rewrite, paraphrase, or edit the student's work for them.
3. **NO GENERATION**: Do not generate new content to be pasted into the document.
4. **EDUCATIONAL FOCUS**: Always explain the "why" behind academic integrity requirements.
5. **CITE YOUR REASONING**: Reference academic standards and best practices when explaining.

**WHEN ASKED TO WRITE/REWRITE**:
- Politely refuse and explain the academic integrity concern
- Suggest self-authoring techniques instead
- Offer educational resources about paraphrasing and citation

**EXPLANATION FRAMEWORK**:
- For similarity flags: Explain the classification (red=needs citation, green=common phrase, blue=properly cited, yellow=close paraphrase)
- For citation questions: Explain when and how to cite according to academic standards
- For policy questions: Clarify institutional and general academic integrity policies

You have access to the student's document content and scan results. Use this context to provide specific, actionable explanations.
`;

  private static readonly CITATION_EXPLANATION_PROMPT = `
PROMPT 4 — Citation Explanation Agent (AI, ON-CLICK ONLY)

This only runs when the user clicks a flag.

You are an academic citation explanation assistant.

You activate ONLY when the user interacts with a citation warning.

Input:
- The flagged text
- Detected issue
- Expected citation rule
- Minimal surrounding context

Your task:
1. Explain what is wrong
2. Explain which citation rule applies
3. Show a corrected example
4. Keep explanation concise and neutral

You must NOT:
- Rewrite the document
- Insert citations
- Suggest new sources
- Override user intent

This is educational AI, not corrective AI.
`;

  private static readonly CITATION_AUDIT_PROMPT = `
PROMPT 6 — Manual Citation Audit Agent (AI, USER-TRIGGERED)

Runs only when the user clicks Run Citation Audit.

You are performing a full-document citation audit.

Scope:
- Entire document

You must:
- Summarize citation issues
- Group issues by severity
- Highlight systemic problems (style mixing, missing references)

You must NOT:
- Edit content
- Rewrite citations
- Add references

Your output is a report, not a fix.
`;

  private static readonly CITATION_SUGGESTION_PROMPT = `
PROMPT 7 — Citation Suggestion Assistant (AI, OPTIONAL, ON-CLICK)

This is separate from monitoring.

You are a citation suggestion assistant.

You activate only when the user clicks "Suggest citation".

Input:
- Selected paragraph
- Claim type (argument, fact, theory)

You must:
- Suggest where a citation would strengthen credibility
- Suggest the type of source needed

You must NOT:
- Generate citations
- Insert references
- Modify text
`;

  /**
   * PROMPT 7: Suggest where citations are needed
   */
  static async suggestCitations(
    input: {
      paragraph: string;
      claimType: string;
    }
  ) {
    const apiKey = await SecretsService.getOpenAiApiKey();
    const openaiProvider = createOpenAI({ apiKey: apiKey || undefined });

    const inputContent = `
[INPUT DATA]
Paragraph: "${input.paragraph}"
Claim Type: ${input.claimType}
`;

    const result = await streamText({
      model: openaiProvider("gpt-4o-mini"),
      system: this.CITATION_SUGGESTION_PROMPT,
      messages: [{ role: "user", content: inputContent }],
      temperature: 0.3,
    });

    return result.toTextStreamResponse();
  }

  /**
   * Create a new chat session
   */
  static async createSession(userId: string, projectId?: string) {
    return prisma.chatSession.create({
      data: {
        user_id: userId,
        project_id: projectId,
        title: "New Integrity Chat",
      },
    });
  }

  /**
   * Get all chat sessions for a user
   */
  static async getUserSessions(userId: string) {
    return prisma.chatSession.findMany({
      where: { user_id: userId },
      orderBy: { updated_at: "desc" },
    });
  }

  /**
   * Update a chat session (e.g. rename)
   */
  static async updateSession(
    sessionId: string,
    userId: string,
    data: { title?: string }
  ) {
    // Verify ownership first
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.user_id !== userId) {
      throw new Error("Session not found or unauthorized");
    }

    return prisma.chatSession.update({
      where: { id: sessionId },
      data,
    });
  }

  /**
   * Delete a chat session
   */
  static async deleteSession(sessionId: string, userId: string) {
    // Verify ownership
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.user_id !== userId) {
      throw new Error("Session not found or unauthorized");
    }

    // Delete messages first (if cascade delete isn't set up, but Prisma usually handles relations if configured, checking schema is safer. Assuming cascade or manual cleanup)
    // Actually, safer to let Prisma/DB handle cascade if configured, or delete messages manually.
    // Let's delete messages to be safe.
    await prisma.chatMessage.deleteMany({
      where: { session_id: sessionId },
    });

    return prisma.chatSession.delete({
      where: { id: sessionId },
    });
  }

  /**
   * Get chat history for a session
   */
  static async getSessionHistory(sessionId: string, userId: string) {
    // Verify ownership
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.user_id !== userId) {
      throw new Error("Session not found or unauthorized");
    }

    return prisma.chatMessage.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: "asc" },
    });
  }

  /**
   * Stream a chat response and persist messages
   */
  static async streamChat(
    messages: any[],
    context: ChatContext,
    sessionId?: string,
    userId?: string
  ) {
    try {
      // Check API Key
      const apiKey = await SecretsService.getOpenAiApiKey();
      if (!apiKey && !config.openai?.apiKey) {
        logger.error("AIChatService: OpenAI API key missing");
        throw new Error("OpenAI API key not configured");
      }

      // If persistent session
      if (sessionId && userId) {
        // Save the last user message (assuming it's the last one in the array)
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role === "user") {
          await prisma.chatMessage.create({
            data: {
              session_id: sessionId,
              role: "user",
              content: lastMessage.content,
            },
          });
        }
      }

      // --- LIMIT ENFORCEMENT START ---
      // --- LIMIT ENFORCEMENT START ---
      try {
        if (!userId) {
          // Should not happen in authenticated context, but safe to ignore or block?
          // Block to be safe.
          throw new Error("User ID missing for AI request");
        }

        // 1. Check Usage Limits ("ai_chat" feature)
        // This deducts from Plan first, then Credits if auto-use is on.
        const consumption = await SubscriptionService.consumeAction(
          userId,
          "ai_chat"
        );

        if (!consumption.allowed) {
          // Return a structured error that the frontend can parse/display
          // Since we are in a stream, we pipe this as a text chunk but the frontend should handle it.
          // Ideally, we'd throw an http error, but for streamText we might need to be careful.
          // Let's return a special system message.
          return new Response(
            JSON.stringify({
              error: consumption.code || "LIMIT_REACHED",
              message: consumption.message || "You have reached your AI usage limit."
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      } catch (error) {
        console.error("AI Limit Check Failed:", error);
        // Fallback: Allow if DB checks fail? Or Block?
        // Block to be safe against abuse.
        return new Response("System Error: Unable to verify usage limits.", { status: 500 });
      }
      // --- LIMIT ENFORCEMENT END ---

      // Construct the full context system message
      let contextMessage = `
[DOCUMENT CONTEXT LOADER]
Document type: ${context.documentType || "Research Paper"}
Academic level: ${context.academicLevel || "Undergraduate"}
Citation style: ${context.citationStyle || "APA 7"}
Discipline: ${context.discipline || "Unknown"}

[DOCUMENT CONTENT]
Title: ${context.projectTitle || "Untitled"}
Description: ${context.projectDescription || "No description"}
Excerpt (around cursor): "${context.selectedText || context.documentContent.slice(0, 2000)
        }..."
[END DOCUMENT CONTEXT]
`;

      // Add originality results if available
      if (context.originalityResults) {
        // PRIORITY: Filter and sort matches to ensure RED/YELLOW flags are seen by the AI
        const allMatches = context.originalityResults.matches || [];

        const criticalMatches = allMatches.filter((m: any) =>
          ["red", "needs_citation"].includes(m.classification)
        );

        const warningMatches = allMatches.filter((m: any) =>
          ["yellow", "close_paraphrase"].includes(m.classification)
        );

        const otherMatches = allMatches.filter(
          (m: any) =>
            !["red", "needs_citation", "yellow", "close_paraphrase"].includes(
              m.classification
            )
        );

        // Combine: Critical -> Warning -> Others
        const prioritizedMatches = [
          ...criticalMatches,
          ...warningMatches,
          ...otherMatches,
        ];

        // Take top 10 to ensure we capture enough context without blowing up tokens
        const matchesForContext = prioritizedMatches.slice(0, 10);

        contextMessage += `
[ORIGINALITY SCAN RESULTS]
Overall Score: ${context.originalityResults.overallScore}%
Classification: ${context.originalityResults.classification}
Matches Found: ${allMatches.length}
CRITICAL FLAGS: ${criticalMatches.length} (These require immediate citation)
WARNING FLAGS: ${warningMatches.length} (These may need paraphrasing)

[TOP PRIORITIZED MATCHES FOR REVIEW]
${JSON.stringify(matchesForContext, null, 2)}
[END ORIGINALITY RESULTS]
`;
      }

      // Add citation suggestions if available
      if (context.citationSuggestions) {
        contextMessage += `
[CITATION SUGGESTIONS]
${JSON.stringify(context.citationSuggestions, null, 2)}
[END CITATION SUGGESTIONS]
`;
      }

      const coreMessages = messages.map((m: any) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content as string,
      }));

      // Log request details for debugging
      logger.info(
        `Starting streamText with model gpt-4o-mini, messages: ${coreMessages.length}`
      );

      const enhancedSystemPrompt = this.SYSTEM_PROMPT + contextMessage;

      try {
        const openaiProvider = createOpenAI({ apiKey: apiKey || undefined });
        const result = await streamText({
          model: openaiProvider("gpt-4o-mini"),
          system: enhancedSystemPrompt,
          messages: coreMessages,
          temperature: 0.3, // Lower temperature for more consistent, factual explanations

          onFinish: async ({ text }) => {
            if (sessionId && userId) {
              try {
                await prisma.chatMessage.create({
                  data: {
                    session_id: sessionId,
                    role: "assistant",
                    content: text,
                  },
                });
              } catch (err) {
                logger.error("Failed to save assistant message", {
                  error: err,
                });
              }
            }
          },
        });

        return result.toTextStreamResponse();
      } catch (streamError: any) {
        logger.error("streamText failed", {
          error: streamError,
          message: streamError.message,
          stack: streamError.stack,
        });
        throw streamError;
      }
    } catch (error: any) {
      logger.error("AI Chat Error (Outer)", {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Generate explanation for specific originality flag
   */
  static async explainOriginalityFlag(flagType: string, context: ChatContext) {
    const flagExplanations: Record<string, string> = {
      red: "RED FLAG: This section shows significant similarity to other sources and requires proper citation. You should either cite the original source or rewrite this content in your own words.",
      yellow:
        "YELLOW WARNING: This section is a close paraphrase of existing content. Consider rewriting with more original phrasing or adding proper citation.",
      green:
        "GREEN OKAY: This appears to be common knowledge or appropriately original content. No action needed.",
      blue: "BLUE CITED: This content is properly quoted and cited. Good job!",
      needs_citation:
        "NEEDS CITATION: This content matches external sources but lacks proper attribution. Add an appropriate citation.",
      common_phrase:
        "COMMON PHRASE: This is a common phrase or widely known fact that doesn't require citation.",
      quoted_correctly:
        "QUOTED CORRECTLY: This content is properly quoted with attribution.",
    };

    const explanation =
      flagExplanations[flagType.toLowerCase()] ||
      `Unclear flag type: ${flagType}. This section has been flagged by our originality scanner. Review for proper citation and originality.`;

    return explanation;
  }

  /**
   * Generate explanation for citation requirements
   */
  static async explainCitationRule(ruleType: string, context: ChatContext) {
    const citationRules: Record<string, string> = {
      direct_quote:
        "Direct quotes must be enclosed in quotation marks and attributed to the original author with proper citation.",
      paraphrase:
        "Paraphrased content must still be cited to the original source, even though you've rewritten it in your own words.",
      common_knowledge:
        "Common knowledge (facts widely known in the field) typically doesn't require citation, but when in doubt, cite.",
      idea_attribution:
        "Ideas, theories, or concepts borrowed from other authors must be cited, even if you express them in your own words.",
      statistical_data:
        "Statistical data, figures, and research findings must always be cited to their original source.",
      summary:
        "Summaries of other authors' work must be cited to give credit to the original source.",
    };

    const explanation =
      citationRules[ruleType.toLowerCase()] ||
      `Unknown citation rule: ${ruleType}. Generally, any content not originally yours should be attributed to its source.`;

    return explanation;
  }

  /**
   * Generate academic integrity policy explanation
   */
  static async explainPolicy(policyType: string, context: ChatContext) {
    const policyExplanations: Record<string, string> = {
      self_plagiarism:
        "Self-plagiarism occurs when you reuse your own previous work without disclosure. Even your own work may need permission to reuse depending on where it was previously published.",
      collaboration_policy:
        "Collaboration policies vary by institution. Always check with your instructor about what level of collaboration is acceptable.",
      citation_standard:
        "Academic citation standards require you to give credit to all sources that contributed to your work, including ideas, data, images, and direct quotes.",
      ai_usage:
        "AI tool usage policies vary by institution. Some allow AI as a research aid, others prohibit it entirely. Always disclose AI usage when required.",
      quotation_format:
        "Proper quotation format requires exact reproduction of text with quotation marks and attribution to the original source.",
    };

    const explanation =
      policyExplanations[policyType.toLowerCase()] ||
      `Unknown policy type: ${policyType}. Consult your institution's academic integrity policy for specific guidance.`;

    return explanation;
  }

  /**
   * PROMPT 3: Explain a specific citation issue (On-Click)
   */
  static async explainCitationIssue(
    issueContext: {
      textSpan: string;
      detectedPattern: string;
      expectedStyle: string;
      surroundingContext: string;
    }
  ) {
    const apiKey = await SecretsService.getOpenAiApiKey();
    const openaiProvider = createOpenAI({ apiKey: apiKey || undefined });

    // Input construction
    const inputContent = `
[INPUT DATA]
Flagged Text: "${issueContext.textSpan}"
Detected Pattern: ${issueContext.detectedPattern}
Expected Style: ${issueContext.expectedStyle}
Context: "...${issueContext.surroundingContext}..."
`;

    // Use streamText or just generateText depending on UI needs. 
    // Assuming UI expects a stream akin to chat, or a block. Let's use streamText for consistency.
    const result = await streamText({
      model: openaiProvider("gpt-4o-mini"),
      system: this.CITATION_EXPLANATION_PROMPT,
      messages: [{ role: "user", content: inputContent }],
      temperature: 0.2,
    });

    return result.toTextStreamResponse();
  }

  /**
   * PROMPT 4: Run full document citation audit
   */
  static async auditCitations(
    documentContent: string,
    citationStyle: string
  ) {
    const apiKey = await SecretsService.getOpenAiApiKey();
    const openaiProvider = createOpenAI({ apiKey: apiKey || undefined });

    const inputContent = `
[AUDIT REQUEST]
Citation Style Target: ${citationStyle}
Document Content:
${documentContent.slice(0, 50000)} // Truncate to safety limit
`;

    const result = await streamText({
      model: openaiProvider("gpt-4o-mini"), // Or gpt-4o for complex audits
      system: this.CITATION_AUDIT_PROMPT,
      messages: [{ role: "user", content: inputContent }],
      temperature: 0.1,
      // response_format: { type: "json_object" } // enforcing JSON if model supports it, but streamText might output raw.
      // We instructed JSON in prompt.
    });

    return result.toTextStreamResponse();
  }
}
