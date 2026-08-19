import { calculateCost, CREDIT_PACKAGES } from "../CreditService";

/**
 * Unit tests for the pure pricing engine. These run with no database and are
 * the safe, always-runnable core of the credit-system test suite.
 *
 * Ledger-accounting tests (grant/reserve/refund/balance) require a live
 * PostgreSQL connection via Prisma and are covered by the end-to-end checks
 * in the plan doc; they are not repeated here to keep `jest` green in any env.
 */

describe("calculateCost — pricing engine", () => {
  describe("scan / citation_audit (1 credit per 1000 words, min 1)", () => {
    it("charges 1 credit for a tiny document (sub-1000 words)", () => {
      expect(calculateCost("scan", { wordCount: 10 })).toBe(1);
      expect(calculateCost("citation_audit", { wordCount: 999 })).toBe(1);
    });

    it("charges 1 credit for exactly 1000 words", () => {
      expect(calculateCost("scan", { wordCount: 1000 })).toBe(1);
    });

    it("rounds up partial thousands", () => {
      expect(calculateCost("scan", { wordCount: 1001 })).toBe(2);
      expect(calculateCost("scan", { wordCount: 2500 })).toBe(3);
    });

    it("handles zero words as the minimum", () => {
      expect(calculateCost("scan", { wordCount: 0 })).toBe(1);
    });
  });

  describe("rephrase (input+output / 1000, min 1)", () => {
    it("sums input and output words", () => {
      expect(calculateCost("rephrase", { inputWords: 500, outputWords: 500 })).toBe(1);
      expect(calculateCost("rephrase", { inputWords: 1500, outputWords: 1500 })).toBe(3);
    });

    it("enforces the minimum", () => {
      expect(calculateCost("rephrase", { inputWords: 100, outputWords: 100 })).toBe(1);
    });
  });

  describe("ai_chat (input+output / 2000, min 1 — cheaper)", () => {
    it("is half the cost of rephrase for the same words", () => {
      expect(calculateCost("ai_chat", { inputWords: 1500, outputWords: 1500 })).toBe(2);
      expect(calculateCost("ai_chat", { inputWords: 500, outputWords: 500 })).toBe(1);
    });
  });

  describe("originality / originality_scan (0.5 per 1000 words, min 1.5)", () => {
    it("applies the 0.5 multiplier with a 1.5 floor", () => {
      // 1500 words -> 2 chunks * 0.5 = 1.0 -> floor -> 1.5
      expect(calculateCost("originality_scan", { wordCount: 1500 })).toBe(1.5);
      // 3500 words -> 4 chunks * 0.5 = 2.0
      expect(calculateCost("originality", { wordCount: 3500 })).toBe(2);
      // 5000 words -> 5 chunks * 0.5 = 2.5
      expect(calculateCost("originality_scan", { wordCount: 5000 })).toBe(2.5);
    });

    it("enforces the 1.5 minimum for tiny documents", () => {
      expect(calculateCost("originality", { wordCount: 10 })).toBe(1.5);
    });
  });

  describe("fallbacks", () => {
    it("returns 1 for unknown features", () => {
      expect(calculateCost("some_future_feature", { wordCount: 99999 })).toBe(1);
    });

    it("returns 1 when metadata is missing", () => {
      expect(calculateCost("scan")).toBe(1);
    });
  });
});

describe("CREDIT_PACKAGES mapping", () => {
  it("maps the current UI packages to their credit amounts", () => {
    expect(CREDIT_PACKAGES.credits_trial).toBe(5);
    expect(CREDIT_PACKAGES.credits_standard).toBe(25);
    expect(CREDIT_PACKAGES.credits_power).toBe(50);
  });

  it("still supports the legacy package ids", () => {
    expect(CREDIT_PACKAGES.credits_10).toBe(10);
    expect(CREDIT_PACKAGES.credits_25).toBe(25);
    expect(CREDIT_PACKAGES.credits_50).toBe(50);
  });
});
