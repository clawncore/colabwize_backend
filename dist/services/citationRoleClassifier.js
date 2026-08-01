"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CitationRoleClassifier = void 0;
const ROLE_PATTERNS = [
    {
        role: "FOUNDATIONAL",
        weight: 1.0,
        patterns: [
            /\bpioneered\b/i,
            /\bseminal\s+work\b/i,
            /\bfirst\s+demonstrated\b/i,
            /\boriginally\s+proposed\b/i,
            /\bgroundbreaking\b/i,
            /\bfoundational\b/i,
            /\bclassic\s+study\b/i,
            /\blandmark\s+(paper|study|work)\b/i,
            /\bfirst\s+(to\s+)?(describe|report|establish|develop)\b/i,
            /\bfundamental\s+(work|study|contribution)\b/i,
        ],
    },
    {
        role: "DATA_SOURCE",
        weight: 0.9,
        patterns: [
            /\bdata\s+(from|collected|obtained|gathered)\b/i,
            /\bmeasured\s+using\b/i,
            /\breported\s+that\b/i,
            /\bfound\s+that\b/i,
            /\bobserved\s+that\b/i,
            /\bdata\s+were\b/i,
            /\breported\s+(a|an|the)\s+(increase|decrease|rate|level|concentration)\b/i,
            /\bshowed\s+(a|an|the)\s+(significant|strong|positive|negative|correlation|effect)\b/i,
            /\bdemonstrated\s+(a|an|the)\s+(rate|level|effect|correlation)\b/i,
        ],
    },
    {
        role: "METHODOLOGICAL",
        weight: 0.95,
        patterns: [
            /\busing\s+the\s+method\b/i,
            /\bfollowing\s+the\s+(procedure|protocol|method)\b/i,
            /\bas\s+described\s+in\b/i,
            /\baccording\s+to\s+(the\s+)?(method|protocol|procedure)\b/i,
            /\badapted\s+from\b/i,
            /\bmethodology\s+of\b/i,
            /\bprotocol\s+from\b/i,
            /\b(was|were)\s+(performed|conducted|carried\s+out)\s+(according|following|using)\b/i,
            /\btechnique\s+(developed|described)\s+by\b/i,
            /\bassay\s+(described|developed)\s+by\b/i,
        ],
    },
    {
        role: "CONTEXTUAL",
        weight: 0.8,
        patterns: [
            /\bprevious\s+work\b/i,
            /\bit\s+has\s+been\s+established\b/i,
            /\bprior\s+research\b/i,
            /\b(earlier|previous)\s+stud(y|ies)\b/i,
            /\bit\s+is\s+well\s+known\b/i,
            /\bbackground\b/i,
            /\bin\s+the\s+context\s+of\b/i,
            /\bas\s+previously\s+(reported|described|shown)\b/i,
            /\bit\s+is\s+generally\s+accepted\b/i,
            /\bin\s+recent\s+years\b/i,
        ],
    },
    {
        role: "NARRATIVE",
        weight: 0.7,
        patterns: [
            /\bsee\s+also\b/i,
            /\bfor\s+a\s+review\b/i,
            /\bfor\s+example\b/i,
            /\bfor\s+instance\b/i,
            /\bas\s+noted\s+by\b/i,
            /\bsee\s+e\.?g\.?\b/i,
            /\be\.?g\.?,\s+/i,
            /\bfor\s+further\s+(reading|details|discussion)\b/i,
            /\bas\s+an\s+example\b/i,
            /\bsuch\s+as\b/i,
        ],
    },
    {
        role: "SECONDARY",
        weight: 0.9,
        patterns: [
            /\bas\s+cited\s+in\b/i,
            /\bquoted\s+in\b/i,
            /\bcited\s+by\b/i,
            /\bdiscussed\s+in\b/i,
            /\bas\s+referenced\s+in\b/i,
            /\bas\s+reported\s+by\b/i,
            /\baccording\s+to\b/i,
        ],
    },
    {
        role: "SUPPORTING",
        weight: 0.95,
        patterns: [
            /\bdemonstrate[sd]?\s+that\b/i,
            /\bshow[sd]?\s+that\b/i,
            /\bconfirm[sd]?\s+that\b/i,
            /\bindicate[sd]?\s+that\b/i,
            /\bsuggest[sd]?\s+that\b/i,
            /\bsupports?\s+the\s+(hypothesis|claim|finding|conclusion)\b/i,
            /\bconsistent\s+with\b/i,
            /\bin\s+agreement\s+with\b/i,
            /\bprovide[sd]?\s+evidence\b/i,
            /\bvalidates?\b/i,
            /\bsubstantiate[sd]?\b/i,
        ],
    },
];
class CitationRoleClassifier {
    /**
     * Classify a single citation based on its surrounding context.
     */
    static classify(text, context) {
        const sourceText = context || text;
        let bestMatch = {
            role: "UNKNOWN",
            confidence: 0,
        };
        for (const roleDef of ROLE_PATTERNS) {
            for (const pattern of roleDef.patterns) {
                const match = sourceText.match(pattern);
                if (match) {
                    const confidence = roleDef.weight * this.computeMatchQuality(match[0], sourceText);
                    if (confidence > bestMatch.confidence) {
                        bestMatch = {
                            role: roleDef.role,
                            confidence: Math.min(confidence, 1.0),
                            pattern: match[0],
                        };
                    }
                }
            }
        }
        return {
            text,
            role: bestMatch.role,
            confidence: bestMatch.confidence,
            matchedPattern: bestMatch.pattern,
        };
    }
    /**
     * Classify multiple citations at once.
     */
    static classifyBatch(citations) {
        return citations.map((c) => this.classify(c.text, c.context));
    }
    /**
     * Get a distribution summary of roles across all classified citations.
     */
    static summarize(classified) {
        const summary = {};
        for (const role of ALL_ROLES) {
            summary[role] = 0;
        }
        for (const c of classified) {
            summary[c.role] = (summary[c.role] || 0) + 1;
        }
        return summary;
    }
    /**
     * Compute match quality based on position and specificity.
     * Patterns closer to the citation anchor get higher weight.
     */
    static computeMatchQuality(matchText, sourceText) {
        const matchIndex = sourceText.indexOf(matchText);
        if (matchIndex < 0)
            return 0.8;
        const citationAnchor = this.findCitationAnchor(sourceText);
        if (citationAnchor < 0)
            return 0.8;
        const distance = Math.abs(matchIndex - citationAnchor);
        const maxDistance = sourceText.length;
        return Math.max(0.5, 1.0 - distance / maxDistance);
    }
    /**
     * Find the approximate position of a citation marker in the text.
     */
    static findCitationAnchor(text) {
        const markerMatch = text.match(/\[\d+\]|\([^)]*\d{4}[^)]*\)/);
        if (markerMatch)
            return markerMatch.index ?? -1;
        const authorMatch = text.match(/[A-Z][a-z]+(?:\s+et\s+al\.?)?(?:\s*\(|,\s*)/);
        if (authorMatch)
            return authorMatch.index ?? -1;
        return -1;
    }
}
exports.CitationRoleClassifier = CitationRoleClassifier;
const ALL_ROLES = [
    "FOUNDATIONAL",
    "DATA_SOURCE",
    "METHODOLOGICAL",
    "CONTEXTUAL",
    "NARRATIVE",
    "SECONDARY",
    "SUPPORTING",
    "UNKNOWN",
];
