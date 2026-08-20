import { ExternalVerificationService } from "../services/citationAudit/externalVerification";

/**
 * Tests for verification status classification behaviour in
 * ExternalVerificationService. We only exercise the public
 * verifyCitationPairs entry point with stubbed internals via
 * provider-free inputs so the tests can run without network access
 * or secrets.
 */

const makePair = (overrides: Record<string, unknown> = {}) => ({
    inline: {
        text: "(Smith, 2020)",
        start: 0,
        end: 13,
        context: "Prior findings were significant.",
    },
    reference: {
        rawText: "Smith, J. (2020). Prior findings. Journal of Examples. 12(3), 45-67.",
        index: 0,
        start: 0,
        end: 80,
        extractedTitle: "Prior findings",
        extractedAuthor: "Smith, J.",
        extractedYear: 2020,
        extractedDOI: "10.1234/example",
        ...overrides,
    },
});

describe("ExternalVerificationService status classification", () => {
    it("returns UNMATCHED_REFERENCE when the reference is missing", async () => {
        const result = await ExternalVerificationService.verifyCitationPairs([
            { inline: makePair().inline, reference: undefined as unknown as any },
        ]);

        expect(result).toHaveLength(1);
        expect(result[0].status).toBe("UNMATCHED_REFERENCE");
    });

    it("returns INSUFFICIENT_INFO for very short references", async () => {
        const result = await ExternalVerificationService.verifyCitationPairs([
            makePair({ rawText: "Smith 20" }),
        ]);

        expect(result).toHaveLength(1);
        expect(result[0].status).toBe("INSUFFICIENT_INFO");
    });
});
