import axios from "axios";
import logger from "../monitoring/logger";
import { config } from "../config/env";
import { SecretsService } from "./secrets-service";

/**
 * Lightweight AI service for text generation tasks
 * Used for rephrasing and basic completions
 */
export class OpenAIService {
  /**
   * Generate text completion using OpenAI API
   */
  static async generateCompletion(
    prompt: string,
    options: {
      maxTokens?: number;
      temperature?: number;
      model?: string;
    } = {}
  ): Promise<string> {
    const {
      maxTokens = 200,
      temperature = 0.7,
      model = "gpt-3.5-turbo",
    } = options;

    try {
      // Check if OpenAI API key is configured
      const apiKey =
        (await SecretsService.getOpenAiApiKey()) || config.openai?.apiKey;

      if (!apiKey) {
        logger.warn("OpenAI API key not configured, using fallback");
        throw new Error("OpenAI API key not configured");
      }

      // Call OpenAI API
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          max_tokens: maxTokens,
          temperature,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 30000, // 30 second timeout
        }
      );

      if (response.data?.choices?.[0]?.message?.content) {
        return response.data.choices[0].message.content.trim();
      }

      throw new Error("Invalid response from OpenAI API");
    } catch (error: any) {
      logger.error("OpenAI API error", {
        error: error.message,
        status: error.response?.status,
      });
      throw error;
    }
  }

  /**
   * Generate multiple rephrase variations
   */
  static async generateRephrases(
    originalText: string,
    count: number = 3
  ): Promise<string[]> {
    const prompt = `Provide ${count} different ways to rephrase the following text while maintaining its meaning and improving originality. Return only the rephrased versions, numbered 1-${count}:

Original text: "${originalText}"

Rephrased versions:`;

    try {
      const response = await this.generateCompletion(prompt, {
        maxTokens: 300,
        temperature: 0.7,
      });

      // Parse numbered list
      const lines = response
        .split(/\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const rephrases: string[] = [];
      for (const line of lines) {
        const cleaned = line.replace(/^\d+[\.\)]\s*/, "").trim();
        if (cleaned.length > 10) {
          rephrases.push(cleaned);
        }
      }

      return rephrases.slice(0, count);
    } catch (error) {
      logger.error("Error generating rephrases", { error });
      throw error;
    }
  }
}
