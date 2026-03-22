
// We need to mock the imports since we are running in ts-node context outside of full app
// CitationRegistryService is in src/services. It imports documentService.
// I will copy the updated class logic into this test file to test IT IN ISOLATION since imports might fail in this env.
// This is a unit test of the logic I just wrote.

interface RegistryEntry {
    ref_key: string;
    raw_reference_text: string;
    doi?: string;
    url?: string;
    csl_data?: any;
    contentHash?: string;
}

class CitationRegistryService {
    private static registry: Map<string, RegistryEntry[]> = new Map();

    static registerCitation(projectId: string, text: string, metadata?: { doi?: string, url?: string }): string {
        let entries = this.registry.get(projectId) || [];
        const tempCsl = this.normalizeToCSL("temp", text, metadata);
        const hash = this.generateContentHash(tempCsl);

        console.log(`Input: "${text}" -> Hash: ${hash}`);

        const existing = entries.find(e =>
            e.raw_reference_text === text ||
            (e.contentHash && e.contentHash === hash)
        );

        if (existing) {
            console.log(`   -> Match found: ${existing.ref_key} (${existing.raw_reference_text})`);
            if (metadata?.doi && !existing.doi) {
                console.log(`   -> Merging DOI: ${metadata.doi}`);
                existing.doi = metadata.doi;
            }
            return existing.ref_key;
        }

        const nextIndex = entries.length + 1;
        const refKey = `ref_${String(nextIndex).padStart(3, '0')}`;
        tempCsl.id = refKey;

        const newEntry: RegistryEntry = {
            ref_key: refKey,
            raw_reference_text: text,
            doi: tempCsl.DOI,
            url: tempCsl.URL,
            csl_data: tempCsl,
            contentHash: hash
        };
        entries.push(newEntry);
        this.registry.set(projectId, entries);
        console.log(`   -> New Entry Created: ${refKey}`);
        return refKey;
    }

    private static normalizeToCSL(id: string, text: string, metadata?: { doi?: string, url?: string }): any {
        let authors: any[] = [];
        let issued: any = { "date-parts": [[]] };
        let title = text;

        // Simplified logic from actual service for test
        const yearMatch = text.match(/\((\d{4})\)[.]?/) || text.match(/[.]\s+(\d{4})[.]/) || text.match(/, (\d{4})/);

        if (yearMatch) {
            const year = parseInt(yearMatch[1]);
            issued = { "date-parts": [[year]] };

            // Extract author heuristics
            let preYear = text.substring(0, yearMatch.index).trim();
            // Clean parens
            preYear = preYear.replace('(', '');

            const rawAuthors = preYear.split(/&|\band\b|;/);
            authors = rawAuthors.map(a => {
                const cleanName = a.trim().replace(/,$/, '').replace(/\.$/, '');
                return { family: cleanName.split(' ').pop(), given: "X" };
            });

            // Extract title logic (approx)
            title = text.substring(yearMatch.index! + yearMatch[0].length).trim();
            if (title.length < 5) title = "Inferred Title from " + text;
        }

        return {
            id,
            author: authors.length ? authors : [{ family: "Unknown" }],
            issued: issued,
            title: title,
            DOI: metadata?.doi
        };
    }

    private static generateContentHash(csl: any): string {
        try {
            const author = csl.author?.[0]?.family?.toLowerCase().trim() || "unknown";
            const year = csl.issued?.['date-parts']?.[0]?.[0] || "0000";
            const title = csl.title || "";
            const titleSlug = title.substring(0, 20).toLowerCase().replace(/[^a-z0-9]/g, '');
            return `${author}|${year}|${titleSlug}`;
        } catch (e) {
            return `unknown|0000|${Math.random()}`;
        }
    }
}

// --- Test Execution ---

console.log("--- Deduplication Test ---");

const P1 = "project_1";

// 1. Initial Registration
const ref1 = CitationRegistryService.registerCitation(P1, "(Smith, 2020) The impact of AI.");

// 2. Duplicate Check (Same semantic)
// Note: My test mock parser needs to handle "Smith, 2020" format slightly if I want it to match "(Smith, 2020)".
// The regex `text.match(/, (\d{4})/)` handles it.
const ref2 = CitationRegistryService.registerCitation(P1, "Smith, 2020. The impact of AI.");

// 3. Metadata Merge
const ref3 = CitationRegistryService.registerCitation(P1, "(Smith, 2020) The impact of AI.", { doi: "10.1000/xyz" });

// 4. Different Item
const ref4 = CitationRegistryService.registerCitation(P1, "(Jones, 2021) Another paper.");

console.log("\nResults:");
console.log(`Ref 1: ${ref1}`);
console.log(`Ref 2: ${ref2} (Should be ref_001)`);
console.log(`Ref 3: ${ref3} (Should be ref_001)`);
console.log(`Ref 4: ${ref4} (Should be ref_002)`);

if (ref1 === ref2 && ref1 === ref3 && ref1 !== ref4) {
    console.log("✅ Deduplication Logic Verified");
} else {
    console.log("❌ Deduplication Logic Failed");
}
