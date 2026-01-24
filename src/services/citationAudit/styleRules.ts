import { CitationStyle, PatternType } from "../../types/citationAudit";

export interface StyleRuleConfig {
    style: CitationStyle;
    version: string;

    allowedInlinePatterns: PatternType[];
    disallowedInlinePatterns: PatternType[];

    referenceList: {
        requiredSectionTitle: string[]; // List of valid titles e.g. ["Works Cited"]
        numberingAllowed: boolean;      // e.g. [1] reference entries
        alphabeticalRequired: boolean;
    };

    // Explicit messages for violations to ensure determinism
    messages: {
        [key in PatternType]?: string; // Message when this pattern is disallowed
    } & {
        WRONG_SECTION_TITLE: string;
        NUMBERED_ENTRIES_DISALLOWED: string;
        NUMBERED_ENTRIES_REQUIRED: string;
    };
}

export const STYLE_RULES: Record<CitationStyle, StyleRuleConfig> = {
    "MLA": {
        style: "MLA",
        version: "9.0",
        allowedInlinePatterns: ["AUTHOR_PAGE", "et_al_with_period"],
        disallowedInlinePatterns: ["NUMERIC_BRACKET", "AUTHOR_YEAR", "et_al_no_period", "AND_IN_PAREN"],
        referenceList: {
            requiredSectionTitle: ["Works Cited"],
            numberingAllowed: false,
            alphabeticalRequired: true
        },
        messages: {
            "NUMERIC_BRACKET": "Numeric bracket citation detected. MLA requires Author-Page format.",
            "AUTHOR_YEAR": "Author-Year citation detected. MLA requires Author-Page format.",
            "et_al_no_period": "'et al' missing period. MLA requires 'et al.'",
            "AND_IN_PAREN": "MLA does not use parenthetical 'and'. Use Author-Page format.",
            "WRONG_SECTION_TITLE": "Incorrect section title. MLA requires 'Works Cited'.",
            "NUMBERED_ENTRIES_DISALLOWED": "Numbered reference entries detected. MLA requires unnumbered, alphabetical entries.",
            "NUMBERED_ENTRIES_REQUIRED": "" // Not used for MLA
        }
    },
    "APA": {
        style: "APA",
        version: "7.0",
        allowedInlinePatterns: ["AUTHOR_YEAR", "et_al_with_period", "AMPERSAND_IN_PAREN"],
        disallowedInlinePatterns: ["NUMERIC_BRACKET", "AUTHOR_PAGE", "et_al_no_period", "AND_IN_PAREN"],
        referenceList: {
            requiredSectionTitle: ["References"],
            numberingAllowed: false,
            alphabeticalRequired: true
        },
        messages: {
            "NUMERIC_BRACKET": "Numeric bracket citation detected. APA requires Author-Year format.",
            "AUTHOR_PAGE": "Author-Page citation detected. APA requires Author-Year format.",
            "et_al_no_period": "'et al' missing period. APA requires 'et al.'",
            "AND_IN_PAREN": "Use '&' instead of 'and' inside parenthetical citations.",
            "WRONG_SECTION_TITLE": "Incorrect section title. APA requires 'References'.",
            "NUMBERED_ENTRIES_DISALLOWED": "Numbered reference entries detected. APA requires unnumbered, alphabetical entries.",
            "NUMBERED_ENTRIES_REQUIRED": ""
        }
    },
    // IEEE
    "IEEE": {
        style: "IEEE",
        version: "2020",
        allowedInlinePatterns: ["NUMERIC_BRACKET"],
        disallowedInlinePatterns: ["AUTHOR_YEAR", "AUTHOR_PAGE"],
        referenceList: {
            requiredSectionTitle: ["References"],
            numberingAllowed: true, // [1] Required
            alphabeticalRequired: false // Ordered by citation
        },
        messages: {
            "AUTHOR_YEAR": "Author-Year citation detected. IEEE requires numeric bracket format [1].",
            "AUTHOR_PAGE": "Author-Page citation detected. IEEE requires numeric bracket format [1].",
            "WRONG_SECTION_TITLE": "Incorrect section title. IEEE requires 'References'.",
            "NUMBERED_ENTRIES_DISALLOWED": "",
            "NUMBERED_ENTRIES_REQUIRED": "Reference entries must be numbered [1] in IEEE style."
        }
    },
    "Chicago": {
        style: "Chicago",
        version: "17 (Author-Date)",
        allowedInlinePatterns: ["AUTHOR_YEAR"], // Assuming Author-Date for this implementation
        disallowedInlinePatterns: ["NUMERIC_BRACKET"],
        referenceList: {
            requiredSectionTitle: ["Bibliography", "References"],
            numberingAllowed: false,
            alphabeticalRequired: true
        },
        messages: {
            "NUMERIC_BRACKET": "Numeric bracket citation detected. Chicago (Author-Date) requires Author-Year format.",
            "WRONG_SECTION_TITLE": "Incorrect section title. Chicago requires 'Bibliography' or 'References'.",
            "NUMBERED_ENTRIES_DISALLOWED": "Numbered reference entries detected. Chicago requires unnumbered entries.",
            "NUMBERED_ENTRIES_REQUIRED": ""
        }
    }
};

export function getStyleRules(style: CitationStyle): StyleRuleConfig {
    // Default to MLA if unknown (or throw, but strictly we assume validated inputs)
    return STYLE_RULES[style] || STYLE_RULES["MLA"];
}
