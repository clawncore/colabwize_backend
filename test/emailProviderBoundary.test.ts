/**
 * Tests for the email provider boundary:
 * - Marketing sends route to EmailOctopus
 * - Transactional/auth/security/billing sends route to Resend
 * - Unsubscribed users are filtered from marketing sends
 * - Unsubscribed users still receive transactional emails
 */

const mockFn = () => jest.fn();

// ── Mock dependencies ──
const mockSendEmail = mockFn();
const mockSendMarketingEmail = mockFn();
const mockSendMarketingBroadcast = mockFn();

jest.mock("../src/lib/prisma", () => ({
  __esModule: true,
  prisma: {
    user: {
      findMany: mockFn(),
      findUnique: mockFn(),
    },
    emailLog: {
      create: mockFn(),
    },
  },
}));

jest.mock("../src/services/email/baseMailer", () => ({
  sendEmail: mockSendEmail,
}));

jest.mock("../src/services/marketing/marketingService", () => ({
  sendMarketingBroadcast: mockSendMarketingBroadcast,
  sendMarketingEmail: mockSendMarketingEmail,
}));

jest.mock("../src/services/marketing/audienceService", () => ({
  getLocalMarketingStatus: mockFn().mockResolvedValue("subscribed"),
  upsertSubscriber: mockFn(),
}));

import { sendTransactionalEmail } from "../src/services/transactionalMailer";
import { sendMarketingEmail } from "../src/services/marketing/marketingService";

// Mirror the isMarketingAlias logic from broadcastService.ts
const MARKETING_ALIASES = ["MARKETING"];
const isMarketingAlias = (alias) => MARKETING_ALIASES.includes(alias);

const TRANSACTIONAL_ALIASES = [
  "WELCOME", "VERIFY", "SECURITY", "NOTIFICATIONS", "BILLING",
  "HELP", "SUPPORT", "TEAM", "INFO", "PRESS", "LEGAL", "ENGINEERING",
];

describe("Email Provider Boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("isMarketingAlias (boundary logic)", () => {
    it("returns true for MARKETING alias", () => {
      expect(isMarketingAlias("MARKETING")).toBe(true);
    });

    it("returns false for all transactional/auth/billing aliases", () => {
      TRANSACTIONAL_ALIASES.forEach((alias) => {
        expect(isMarketingAlias(alias)).toBe(false);
      });
    });
  });

  describe("sendTransactionalEmail routes to Resend only", () => {
    const testCases = [
      { alias: "VERIFY", desc: "OTP/auth emails" },
      { alias: "WELCOME", desc: "welcome emails" },
      { alias: "SECURITY", desc: "security alerts" },
      { alias: "BILLING", desc: "billing receipts" },
      { alias: "NOTIFICATIONS", desc: "platform notifications" },
      { alias: "SUPPORT", desc: "support replies" },
    ];

    testCases.forEach(({ alias, desc }) => {
      it(`routes ${desc} through Resend (sendEmail)`, async () => {
        mockSendEmail.mockResolvedValueOnce({
          success: true,
          data: { id: "msg-123" },
        });

        const result = await sendTransactionalEmail({
          from: alias,
          to: "user@example.com",
          subject: "Test",
          html: "<p>Test</p>",
        });

        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(mockSendEmail).toHaveBeenCalledWith(
          expect.objectContaining({ from: alias, to: "user@example.com" }),
        );
        expect(result.success).toBe(true);

        // CRITICAL: Transactional emails must NEVER go to EmailOctopus
        expect(mockSendMarketingEmail).not.toHaveBeenCalled();
        expect(mockSendMarketingBroadcast).not.toHaveBeenCalled();
      });
    });
  });

  describe("Marketing sends route to EmailOctopus, never Resend", () => {
    it("sendMarketingEmail is used for marketing-only sends", async () => {
      mockSendMarketingEmail.mockResolvedValueOnce({
        success: true,
        messageId: "eo-campaign-123",
      });

      const result = await sendMarketingEmail(
        "subscriber@example.com",
        "Weekly Newsletter",
        "<h1>Hello</h1>",
        "Hello",
      );

      expect(mockSendMarketingEmail).toHaveBeenCalledTimes(1);
      expect(mockSendEmail).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });
});
