import { ExternalVerificationService } from "./src/services/citationAudit/externalVerification";
import { CitationPair } from "./src/services/citationAudit/citationMatcher";

async function run() {
    console.log("Testing ExternalVerificationService...");
    const pairs: CitationPair[] = [
        {
            inline: {
                text: "(Deeks, Lewin, & Havlir, 2013)",
                start: 10,
                end: 40,
                patternType: "AUTHOR_YEAR",
                context: "The end of HIV as a public health threat is widely debated (Deeks, Lewin, & Havlir, 2013)."
            },
            reference: {
                rawText: "Deeks, S. G., Lewin, S. R., & Havlir, D. V. (2013). The end of AIDS: HIV infection as a chronic disease. The Lancet, 382(9903), 1525-1533.",
                index: 0,
                extractedTitle: "The end of AIDS: HIV infection as a chronic disease",
                extractedAuthor: "Deeks",
                extractedYear: 2013
            }
        }
    ];

    try {
        const results = await ExternalVerificationService.verifyCitationPairs(pairs);
        console.log(JSON.stringify(results, null, 2));
    } catch (e) {
        console.error("Error:", e);
    }
}

run();
