/**
 * LemonSqueezy Checkout URL Pass-Through Tests
 *
 * Verifies that the signed LemonSqueezy checkout URL is returned to the
 * frontend EXACTLY as LemonSqueezy returns it — never mutated with appended
 * query parameters (which would invalidate the signature).
 *
 * Key invariants tested:
 * 1. The checkout URL returned to the frontend matches what LS API returned.
 * 2. No discount param is appended to the signed URL.
 * 3. discount_code is sent via checkout_data during creation, not URL post-hoc.
 * 4. A malformed LS response (missing URL) fails with an application error.
 */

jest.mock("../src/lib/prisma", () => ({
  __esModule: true,
  prisma: {},
}));

jest.mock("../src/services/secrets-service", () => ({
  __esModule: true,
  SecretsService: {
    getLemonsqueezyApiKey: jest.fn().mockResolvedValue("test-api-key"),
    getLemonsqueezyStoreId: jest.fn().mockResolvedValue("12345"),
    getLemonsqueezyWebhookSecret: jest.fn().mockResolvedValue("test-webhook-secret"),
  },
}));

jest.mock("../src/monitoring/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ── Imports after mocks ──────────────────────────────────────────────────────────
import { LemonSqueezyService } from "../src/services/lemonSqueezyService";

// ── Tests ────────────────────────────────────────────────────────────────────────

describe("LemonSqueezy checkout URL pass-through", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the signed URL exactly as LemonSqueezy returns it (no mutation)", async () => {
    const lsSignedUrl =
      "https://store.colabwize.com/checkout/custom/abc-123?signature=deadbeef";

    const mockFetch = jest.fn();
    (global as any).fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          id: "1",
          type: "checkouts",
          attributes: { url: lsSignedUrl },
        },
      }),
    });

    const result = await LemonSqueezyService.createCheckout({
      variantId: "var-123",
      userEmail: "user@example.com",
      userId: "user-1",
      discountCode: "COLAB60",
    });

    // URL must be returned unchanged — no appended discount param
    expect(result).toBe(lsSignedUrl);
    expect(result).not.toContain("discount=");
  });

  it("passes discountCode via checkout_data.discount_code in the request body", async () => {
    const lsSignedUrl = "https://store.colabwize.com/checkout/custom/xyz";

    const mockFetch = jest.fn();
    (global as any).fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          attributes: { url: lsSignedUrl },
        },
      }),
    });

    await LemonSqueezyService.createCheckout({
      variantId: "var-456",
      userEmail: "test@example.com",
      userId: "user-2",
      discountCode: "COLAB60",
    });

    // Verify the request body included discount_code in checkout_data
    const fetchCall = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);

    expect(requestBody.data.attributes.checkout_data.discount_code).toBe(
      "COLAB60",
    );
  });

  it("omits discount_code when no promo is provided", async () => {
    const lsSignedUrl = "https://store.colabwize.com/checkout/custom/nodisc";

    const mockFetch = jest.fn();
    (global as any).fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          attributes: { url: lsSignedUrl },
        },
      }),
    });

    await LemonSqueezyService.createCheckout({
      variantId: "var-789",
      userEmail: "plain@example.com",
      userId: "user-3",
    });

    const fetchCall = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);

    expect(requestBody.data.attributes.checkout_data.discount_code).toBe(
      undefined,
    );
  });

  it("throws when LemonSqueezy response has no checkout URL", async () => {
    const mockFetch = jest.fn();
    (global as any).fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          attributes: { url: null },
        },
      }),
    });

    await expect(
      LemonSqueezyService.createCheckout({
        variantId: "var-bad",
        userEmail: "err@example.com",
        userId: "user-bad",
      }),
    ).rejects.toThrow(/valid checkout URL/i);
  });

  it("throws when LemonSqueezy response URL is not HTTPS", async () => {
    const mockFetch = jest.fn();
    (global as any).fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          attributes: { url: "http://insecure.example.com/checkout" },
        },
      }),
    });

    await expect(
      LemonSqueezyService.createCheckout({
        variantId: "var-insecure",
        userEmail: "bad@example.com",
        userId: "user-insecure",
      }),
    ).rejects.toThrow(/checkout URL/i);
  });
});
