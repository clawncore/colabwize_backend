const { compareTwoStrings } = require("string-similarity");
import logger from "../monitoring/logger";
import { chatComplete } from "./llm/llmClient";

interface HumanizationResult {
    variations: string[];
    provider: "openai" | "local";
}

const SYNONYMS: Record<string, string[]> = {
    important: ["significant", "crucial", "vital", "essential", "key"],
    analyze: ["examine", "investigate", "study", "evaluate", "assess"],
    demonstrate: ["show", "illustrate", "prove", "exhibit", "reveal"],
    significant: ["substantial", "considerable", "notable", "meaningful"],
    research: ["study", "investigation", "enquiry", "exploration"],
    therefore: ["thus", "consequently", "accordingly", "hence"],
    however: ["nevertheless", "nonetheless", "yet", "although"],
    moreover: ["furthermore", "additionally", "besides"],
    conclude: ["deduce", "infer", "determine", "summarize"],
    use: ["utilize", "employ", "apply", "leverage"],
    show: ["indicate", "demonstrate", "reveal", "illustrate"],
    change: ["transform", "modify", "alter", "adjust"],
    help: ["facilitate", "assist", "enable", "support"],
    get: ["obtain", "acquire", "secure", "attain"],
    make: ["create", "produce", "construct", "generate"],
};

const PHRASES: Record<string, string> = {
    "in conclusion": "to conclude",
    "on the other hand": "alternatively",
    "as a result": "consequently",
    "due to": "owing to",
    "in addition": "furthermore",
    "for example": "for instance",
    "according to": "as stated by",
    "in other words": "that is to say",
    "a lot of": "numerous",
    "because of": "on account of",
};

export class HumanizerService {
    static async humanizeText(text: string): Promise<HumanizationResult> {
        // Try OpenAI first. If the call returns nothing (no key, network error,
        // bad model), fall back to the local heuristic so the inline rewriter
        // remains usable on every deployment.
        const systemPrompt = `You are an expert academic editor. Rewrite the user's passage into 2 distinct variations that preserve the original meaning. Hard rules:
1. Preserve every citation, reference, author name, year, DOI, and URL exactly.
2. Preserve every numerical value, unit, p-value, and statistical symbol.
3. Do not invent facts or references.
4. Preserve technical terminology; do not synonymize terms of art.
5. Do not introduce unicode homoglyphs or invisible characters.
Output only the 2 versions separated by a line containing exactly: ---VARIATION---`;
        const userPrompt = `Rewrite the following passage:\n\n---\n${text}\n---`;

        const raw = await chatComplete(systemPrompt, userPrompt, {
            temperature: 0.5,
            maxTokens: 1500,
        });

        if (raw) {
            const variants = raw
                .split(/---\s*VARIATION\s*---/i)
                .map((v) => v.trim())
                .filter((v) => v.length > 20 && v !== text);

            if (variants.length > 0) {
                return {
                    variations: variants.slice(0, 3),
                    provider: "openai",
                };
            }
        }

        return this.localHumanize(text);
    }

    /**
     * Deterministic synonym/phrase rewrite. Used as graceful degradation when
     * OpenAI is unavailable. Always returns provider: "local" so callers can
     * surface a banner if needed.
     */
    private static localHumanize(text: string): HumanizationResult {
        const variations: string[] = [];

        const v1 = this.replaceSynonyms(text);
        if (v1 !== text) variations.push(v1);

        const v2 = this.replacePhrases(text);
        if (v2 !== text && !this.isTooSimilar(variations, v2)) variations.push(v2);

        const v3 = text
            .replace(/\bi\b/g, "one")
            .replace(/\byou\b/g, "one")
            .replace(/\bwe\b/g, "researchers")
            .replace(/\bthink\b/g, "consider")
            .replace(/\bsay\b/g, "suggest")
            .replace(/\bseems\b/g, "appears");
        if (v3 !== text && !this.isTooSimilar(variations, v3)) variations.push(v3);

        if (variations.length === 0) {
            variations.push(text);
        }

        return { variations: variations.slice(0, 3), provider: "local" };
    }

    static async rewriteSelection(selection: string, _surroundingContext?: string): Promise<HumanizationResult> {
        return this.humanizeText(selection);
    }

    private static replaceSynonyms(text: string): string {
        let result = text;
        for (const [word, replacements] of Object.entries(SYNONYMS)) {
            const regex = new RegExp("\\b" + word + "\\b", "gi");
            result = result.replace(regex, replacements[0]);
        }
        return result;
    }

    private static replacePhrases(text: string): string {
        let result = text;
        for (const [phrase, replacement] of Object.entries(PHRASES)) {
            const regex = new RegExp(phrase, "gi");
            result = result.replace(regex, replacement);
        }
        return result;
    }

    private static isTooSimilar(suggestions: string[], candidate: string): boolean {
        for (const s of suggestions) {
            if (compareTwoStrings(s, candidate) > 0.85) return true;
        }
        return false;
    }
}
