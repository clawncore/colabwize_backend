/**
 * Lightweight LLM client wrapper.
 *
 * Picks the configured provider from env, returns a tiny unified interface so
 * callers don't need to import OpenAI-specific types. Falls back to `null`
 * if no key is configured — callers MUST handle the null case (return local
 * heuristic output) so free tools stay functional even without a paid key.
 */

import { ChatOpenAI } from "@langchain/openai";
import { SecretsService } from "../secrets-service";
import logger from "../../monitoring/logger";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequestOptions {
  /** Model override. Default: "gpt-4o-mini" for cost-effective free tools. */
  model?: string;
  /** 0 = deterministic, 1 = max creativity. Default 0.4 for academic tone. */
  temperature?: number;
  /** Max output tokens. Default 2000. */
  maxTokens?: number;
  /** Hard timeout in ms. Default 25s. */
  timeoutMs?: number;
}

let cachedClient: ChatOpenAI | null = null;
let cachedClientKey: string | null = null;

/**
 * Resolve the configured chat model. Returns `null` when no API key is set,
 * which the caller is expected to handle by degrading gracefully to a local
 * heuristic. This keeps free tools useful on dev / unpaid deployments.
 *
 * LangChain only accepts temperature/maxTokens/timeout as constructor fields
 * (not per-invoke options), so the cache key spans every knob callers can
 * tweak — distinct option sets get their own short-lived client.
 */
export async function getChatModel(
  opts: ChatRequestOptions = {},
): Promise<ChatOpenAI | null> {
  const apiKey = await SecretsService.getOpenAiApiKey();
  if (!apiKey) {
    logger.warn("[LLM] OPENAI_API_KEY not configured; falling back to local heuristic");
    return null;
  }

  const modelName = opts.model || process.env.REWRITER_MODEL || "gpt-4o-mini";
  const temperature = opts.temperature ?? 0.4;
  const maxTokens = opts.maxTokens ?? 2000;
  const timeout = opts.timeoutMs ?? 25_000;
  const cacheKey = `${apiKey}|${modelName}|${temperature}|${maxTokens}|${timeout}`;

  if (!cachedClient || cachedClientKey !== cacheKey) {
    cachedClient = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName,
      temperature,
      maxTokens,
      timeout,
    });
    cachedClientKey = cacheKey;
  }

  return cachedClient;
}

/**
 * Convenience: invoke the chat model with a system + user prompt pair.
 * Returns the assistant text content, or `null` if no model is available
 * or the call fails (callers should handle `null` and fall back to local).
 */
export async function chatComplete(
  systemPrompt: string,
  userPrompt: string,
  opts: ChatRequestOptions = {},
): Promise<string | null> {
  try {
    const model = await getChatModel(opts);
    if (!model) return null;

    const { SystemMessage, HumanMessage } = await import("@langchain/core/messages");

    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    const content =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .map((c: any) => (typeof c === "string" ? c : c?.text || ""))
              .join("")
          : String(response.content || "");

    return content.trim() || null;
  } catch (error: any) {
    logger.error("[LLM] chatComplete failed", { error: error.message });
    return null;
  }
}
