const { compareTwoStrings } = require("string-similarity");
import logger from "../monitoring/logger";

interface HumanizationResult {
    variations: string[];
    provider: "local";
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
