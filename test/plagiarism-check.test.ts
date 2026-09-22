/**
 * Tests for the free plagiarism-check endpoint logic.
 *
 * We test the handler function directly by invoking the route's stack
 * handler (skipping the rate-limit middleware wrapper). CopyscapeService
 * is mocked so tests run fully offline.
 */
import { Request, Response, NextFunction } from "express";

// ── Mock CopyscapeService BEFORE importing the router ────────────────────────
const mockScanText = jest.fn();

jest.mock("../src/services/copyscapeService", () => ({
  CopyscapeService: {
    scanText: (...args: any[]) => mockScanText(...args),
  },
}));

// Mock logger
jest.mock("../src/monitoring/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import AFTER mocks
import router from "../src/api/free/plagiarism-check";

// ── Helper: extract the actual route handler (stack[1], skipping rate-limit) ─
function getRouteHandler() {
  const layers: any[] = (router as any).stack || [];
  for (const layer of layers) {
    const route = layer.route;
    if (route && route.path === "/plagiarism-check" && route.methods.post) {
      const routeStack = route.stack || [];
      // stack[0] is rate-limit middleware wrapper (3 params), stack[1] is the
      // actual handler (2 params: req, res). We test the real handler directly.
      return routeStack[routeStack.length - 1].handle as (req: Request, res: Response) => Promise<void>;
    }
  }
  throw new Error("Route /plagiarism-check POST not found");
}

function mockResponse(): Response {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  };
  return res as Response;
}

function mockRequest(body: any): Request {
  return { body } as Request;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/free/plagiarism-check", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should accept 'text' field and return 200 with results", async () => {
    mockScanText.mockResolvedValue({
      matches: [
        {
          start: 0, end: 50, similarity: 85,
          sourceUrl: "https://example.com/source",
          provider: "copyscape", confidence: "high", matchedWords: 5,
        },
      ],
      summary: { queryWords: 9, cost: 0, count: 1, allPercentMatched: 50 },
    });

    const handler = getRouteHandler();
    const req = mockRequest({ text: "This is some sample text to check for plagiarism." });
    const res = mockResponse();

    await handler(req, res);

    // The handler calls res.json() directly (Express defaults to 200)
    const jsonData = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonData.success).toBe(true);
    expect(jsonData.data.originalityScore).toBe(50);
    expect(jsonData.data.similarityScore).toBe(50);
    // "This is some sample text to check for plagiarism." = 9 words
    expect(jsonData.data.totalWords).toBe(9);
    expect(jsonData.data.matches).toHaveLength(1);
    expect(jsonData.data.processingTime).toBeGreaterThanOrEqual(0);
    expect(jsonData.data.matchedWords).toBe(5);
    // If status was called, it should be 200
    if ((res.status as jest.Mock).mock.calls.length > 0) {
      expect(res.status).toHaveBeenCalledWith(200);
    }
  });

  it("should accept legacy 'content' field (backward compatibility)", async () => {
    mockScanText.mockResolvedValue({
      matches: [],
      summary: { queryWords: 5, cost: 0, count: 0, allPercentMatched: 0 },
    });

    const handler = getRouteHandler();
    const req = mockRequest({ content: "Hello world this is a test" });
    const res = mockResponse();

    await handler(req, res);

    const jsonData = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonData.success).toBe(true);
    expect(jsonData.data.originalityScore).toBe(100);
    expect(jsonData.data.similarityScore).toBe(0);
  });

  it("should prefer 'text' over 'content' when both are provided", async () => {
    mockScanText.mockResolvedValue({
      matches: [],
      summary: { queryWords: 3, cost: 0, count: 0, allPercentMatched: 0 },
    });

    const handler = getRouteHandler();
    const req = mockRequest({ text: "primary content", content: "fallback content" });
    const res = mockResponse();

    await handler(req, res);

    expect(mockScanText).toHaveBeenCalledWith("primary content");
  });

  it("should return 400 when neither text nor content is provided", async () => {
    const handler = getRouteHandler();
    const req = mockRequest({});
    const res = mockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const jsonData = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonData.success).toBe(false);
    expect(jsonData.message).toMatch(/content is required/i);
  });

  it("should return 400 when text is empty or whitespace only", async () => {
    const handler = getRouteHandler();
    const req = mockRequest({ text: "   " });
    const res = mockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const jsonData = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonData.success).toBe(false);
  });

  it("should return 400 when text is not a string", async () => {
    const handler = getRouteHandler();
    const req = mockRequest({ text: 12345 });
    const res = mockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const jsonData = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonData.success).toBe(false);
  });

  it("should return 400 when content exceeds 5000 words", async () => {
    const handler = getRouteHandler();
    const req = mockRequest({ text: Array(5001).fill("word").join(" ") });
    const res = mockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const jsonData = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonData.success).toBe(false);
    expect(jsonData.message).toMatch(/word limit/i);
  });

  it("should return 500 when CopyscapeService throws", async () => {
    mockScanText.mockRejectedValue(new Error("Service down"));

    const handler = getRouteHandler();
    const req = mockRequest({ text: "Some text" });
    const res = mockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const jsonData = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonData.success).toBe(false);
    expect(jsonData.message).toBe("Service down");
  });

  it("should calculate matchedWords from matches", async () => {
    mockScanText.mockResolvedValue({
      matches: [
        { start: 0, end: 10, similarity: 80, sourceUrl: "a", provider: "internal", confidence: "high", matchedWords: 3 },
        { start: 10, end: 20, similarity: 70, sourceUrl: "b", provider: "internal", confidence: "medium", matchedWords: 7 },
      ],
      summary: { queryWords: 10, cost: 0, count: 2, allPercentMatched: 75 },
    });

    const handler = getRouteHandler();
    const req = mockRequest({ text: "sample text here" });
    const res = mockResponse();

    await handler(req, res);

    const jsonData = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonData.data.matchedWords).toBe(10); // 3 + 7
    expect(jsonData.data.originalityScore).toBe(25); // 100 - 75
  });

  it("should return 100% originality when no matches found", async () => {
    mockScanText.mockResolvedValue({
      matches: [],
      summary: { queryWords: 5, cost: 0, count: 0, allPercentMatched: 0 },
    });

    const handler = getRouteHandler();
    const req = mockRequest({ text: "completely original content" });
    const res = mockResponse();

    await handler(req, res);

    const jsonData = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonData.data.originalityScore).toBe(100);
    expect(jsonData.data.similarityScore).toBe(0);
    expect(jsonData.data.matches).toHaveLength(0);
    expect(jsonData.data.matchedWords).toBe(0);
  });

  it("should pass the correct content to CopyscapeService.scanText", async () => {
    mockScanText.mockResolvedValue({
      matches: [],
      summary: { queryWords: 3, cost: 0, count: 0, allPercentMatched: 0 },
    });

    const handler = getRouteHandler();
    const testText = "unique test content";
    const req = mockRequest({ text: testText });
    const res = mockResponse();

    await handler(req, res);

    expect(mockScanText).toHaveBeenCalledWith(testText);
  });

  it("should handle matches without matchedWords field", async () => {
    mockScanText.mockResolvedValue({
      matches: [
        { start: 0, end: 10, similarity: 85, sourceUrl: "a", provider: "copyscape", confidence: "high" },
      ],
      summary: { queryWords: 5, cost: 0, count: 1, allPercentMatched: 85 },
    });

    const handler = getRouteHandler();
    const req = mockRequest({ text: "test content" });
    const res = mockResponse();

    await handler(req, res);

    const jsonData = (res.json as jest.Mock).mock.calls[0][0];
    // Should treat missing matchedWords as 0
    expect(jsonData.data.matchedWords).toBe(0);
  });
});
