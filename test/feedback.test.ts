/**
 * Tests for the feedback API routes and FeedbackService.
 *
 * Tests cover:
 * - POST /api/feedback/public (create feedback without auth)
 * - POST /api/feedback (create feedback with auth)
 * - GET /api/feedback (get all feedback, admin sees all, user sees own)
 * - GET /api/feedback/my (get user's own feedback)
 * - GET /api/feedback/:id (get feedback by ID, authz checks)
 * - PATCH /api/feedback/:id/status (update status, admin only)
 * - POST /api/feedback/:id/comments (add comment)
 * - GET /api/feedback/:id/comments (get comments, internal filter)
 * - GET /api/feedback/stats/summary (admin-only stats)
 *
 * Mocks: prisma.UserFeedback, prisma.FeedbackComment, prisma.User, AuditLog, EmailService
 */

// ── Mock helpers ──────────────────────────────────────────────────────────────
const mockFn = () => jest.fn().mockResolvedValue(undefined);

// ── Mock prisma ───────────────────────────────────────────────────────────────
jest.mock("../src/lib/prisma", () => ({
  __esModule: true,
  prisma: {
    userFeedback: {
      create: mockFn(),
      findMany: mockFn(),
      findUnique: mockFn(),
      update: mockFn(),
      count: mockFn(),
      groupBy: mockFn(),
    },
    feedbackComment: {
      create: mockFn(),
      findMany: mockFn(),
    },
    user: {
      findUnique: mockFn(),
    },
    auditLog: {
      create: mockFn(),
    },
  },
}));

// ── Mock SecretsService ───────────────────────────────────────────────────────
const mockAdminUserIds: string[] = [];
const mockFeedbackEmail = "feedback@colabwize.com";

jest.mock("../src/services/secrets-service", () => ({
  __esModule: true,
  default: {
    getAdminUserIds: jest.fn().mockImplementation(async () => mockAdminUserIds),
    getFeedbackEmail: jest.fn().mockResolvedValue(mockFeedbackEmail),
  },
}));

// ── Mock EmailService ─────────────────────────────────────────────────────────
jest.mock("../src/services/emailService", () => ({
  EmailService: {
    sendNotificationEmail: jest.fn().mockResolvedValue(true),
  },
}));

// ── Mock logger ───────────────────────────────────────────────────────────────
jest.mock("../src/monitoring/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ── Mock recaptcha ────────────────────────────────────────────────────────────
jest.mock("../src/utils/recaptcha", () => ({
  verifyRecaptcha: jest.fn().mockResolvedValue({ success: true }),
}));

// ── Mock auth middleware ──────────────────────────────────────────────────────
jest.mock("../src/middleware/auth", () => ({
  authenticateExpressRequest: (req: any, _res: any, next: any) => {
    // Attach mock user from request header
    req.user = req.headers["x-test-user"]
      ? { id: req.headers["x-test-user"] as string, email: "user@example.com", user_role: req.headers["x-test-role"] as string || "user" }
      : null;
    next();
  },
}));

// ── Imports after mocks ───────────────────────────────────────────────────────
import { prisma } from "../src/lib/prisma";
import { FeedbackService } from "../src/services/feedbackService";
import SecretsService from "../src/services/secrets-service";
import { EmailService } from "../src/services/emailService";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const USER_ID = "user-123";
const ADMIN_ID = "admin-456";
const FEEDBACK_ID = "feedback-abc-123";
const FEEDBACK_ID_2 = "feedback-def-456";

const mockFeedback = (overrides: Partial<any> = {}): any => ({
  id: FEEDBACK_ID,
  user_id: USER_ID,
  type: "feedback",
  category: "general",
  priority: "medium",
  title: "Test Feedback Title",
  description: "This is a test feedback description",
  status: "open",
  attachment_urls: [],
  browser_info: "Mozilla/5.0",
  os_info: "MacOS",
  screen_size: "1920x1080",
  user_plan: "free",
  admin_notes: null,
  created_at: new Date("2025-01-15T10:00:00Z"),
  updated_at: new Date("2025-01-15T10:00:00Z"),
  resolved_at: null,
  ...overrides,
});

const mockComment = (overrides: Partial<any> = {}): any => ({
  id: "comment-123",
  feedback_id: FEEDBACK_ID,
  user_id: USER_ID,
  content: "This is a test comment",
  is_internal: false,
  created_at: new Date("2025-01-16T10:00:00Z"),
  updated_at: new Date("2025-01-16T10:00:00Z"),
  user: {
    full_name: "Test User",
    email: "user@example.com",
  },
  ...overrides,
});

// ── Helper: reset all mocks ──────────────────────────────────────────────────
function resetMocks() {
  jest.clearAllMocks();
  mockAdminUserIds.length = 0; // clear admin user IDs
  // Re-mock default resolved values
  (prisma.userFeedback.create as jest.Mock).mockResolvedValue(mockFeedback());
  (prisma.userFeedback.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.userFeedback.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.userFeedback.update as jest.Mock).mockResolvedValue(mockFeedback());
  (prisma.userFeedback.count as jest.Mock).mockResolvedValue(0);
  (prisma.userFeedback.groupBy as jest.Mock).mockResolvedValue([]);
  (prisma.feedbackComment.create as jest.Mock).mockResolvedValue(mockComment());
  (prisma.feedbackComment.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.auditLog.create as jest.Mock).mockResolvedValue({});
  (SecretsService.getAdminUserIds as jest.Mock).mockResolvedValue(mockAdminUserIds);
  (SecretsService.getFeedbackEmail as jest.Mock).mockResolvedValue(mockFeedbackEmail);
  (EmailService.sendNotificationEmail as jest.Mock).mockResolvedValue(true);
}

// ── FeedbackService.isUserAdmin tests ─────────────────────────────────────────
describe("FeedbackService.isUserAdmin", () => {
  beforeEach(resetMocks);

  it("returns true when user has admin role", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: ADMIN_ID,
      user_role: "admin",
      email: "admin@colabwize.com",
    });

    const result = await FeedbackService.isUserAdmin(ADMIN_ID);
    expect(result).toBe(true);
  });

  it("returns true when user is in feedback team", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "feedback-123",
      user_role: "feedback",
      email: "feedback@colabwize.com",
    });

    const result = await FeedbackService.isUserAdmin("feedback-123");
    expect(result).toBe(true);
  });

  it("returns true when user has @colabwize.com email", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "team-123",
      user_role: "user",
      email: "team@colabwize.com",
    });

    const result = await FeedbackService.isUserAdmin("team-123");
    expect(result).toBe(true);
  });

  it("returns true when user ID is in adminUserIds list", async () => {
    mockAdminUserIds.push(USER_ID);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: USER_ID,
      user_role: "user",
      email: "regular@example.com",
    });

    const result = await FeedbackService.isUserAdmin(USER_ID);
    expect(result).toBe(true);
  });

  it("returns false for regular users", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: USER_ID,
      user_role: "user",
      email: "regular@example.com",
    });

    const result = await FeedbackService.isUserAdmin(USER_ID);
    expect(result).toBe(false);
  });

  it("returns false when user does not exist", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const result = await FeedbackService.isUserAdmin("nonexistent");
    expect(result).toBe(false);
  });
});

// ── FeedbackService.createFeedback tests ──────────────────────────────────────
describe("FeedbackService.createFeedback", () => {
  beforeEach(resetMocks);

  it("creates a feedback item with all fields", async () => {
    const feedbackData = {
      user_id: USER_ID,
      type: "bug_report",
      category: "performance",
      priority: "high",
      title: "Page crashes on load",
      description: "The app crashes when loading on Chrome",
      status: "open",
      attachment_urls: ["https://example.com/screenshot.png"],
      browser_info: "Mozilla/5.0",
      os_info: "Linux",
      screen_size: "2560x1440",
      user_plan: "plus",
      admin_notes: null,
    };

    const created = await FeedbackService.createFeedback(feedbackData);
    expect(prisma.userFeedback.create).toHaveBeenCalledWith({
      data: feedbackData,
    });
    expect(created).toMatchObject({
      id: FEEDBACK_ID,
      type: "bug_report",
      title: "Page crashes on load",
    });
  });

  it("handles null user_id for public feedback", async () => {
    const feedbackData = {
      user_id: null,
      type: "feature_request",
      category: null,
      priority: "medium",
      title: "Add dark mode",
      description: "Would love a dark theme option",
      status: "open",
      attachment_urls: [],
      browser_info: null,
      os_info: null,
      screen_size: null,
      user_plan: null,
      admin_notes: null,
    };

    const created = await FeedbackService.createFeedback(feedbackData);
    expect(prisma.userFeedback.create).toHaveBeenCalled();
    expect(created).toBeDefined();
  });

  it("throws an error when creation fails", async () => {
    (prisma.userFeedback.create as jest.Mock).mockRejectedValue(
      new Error("DB error")
    );

    await expect(
      FeedbackService.createFeedback({
        user_id: USER_ID,
        type: "feedback",
        category: null,
        priority: "medium",
        title: "Test",
        description: "Test",
        status: "open",
        attachment_urls: [],
        browser_info: null,
        os_info: null,
        screen_size: null,
        user_plan: null,
        admin_notes: null,
      })
    ).rejects.toThrow("Failed to create feedback");
  });
});

// ── FeedbackService.getFeedbackItems tests ──────────────────────────────────────
describe("FeedbackService.getFeedbackItems", () => {
  beforeEach(resetMocks);

  it("returns all feedback for admin users", async () => {
    mockAdminUserIds.push(ADMIN_ID);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: ADMIN_ID,
      user_role: "admin",
      email: "admin@colabwize.com",
    });
    (prisma.userFeedback.findMany as jest.Mock).mockResolvedValue([
      mockFeedback(),
      mockFeedback({ id: FEEDBACK_ID_2 }),
    ]);

    const result = await FeedbackService.getFeedbackItems(ADMIN_ID, {}, 50);
    expect(prisma.userFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        orderBy: { created_at: "desc" },
        take: 50,
      })
    );
    expect(result).toHaveLength(2);
  });

  it("filters by type when provided", async () => {
    (prisma.userFeedback.findMany as jest.Mock).mockResolvedValue([mockFeedback()]);
    await FeedbackService.getFeedbackItems(USER_ID, { type: "bug_report" });
    expect(prisma.userFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "bug_report" }),
      })
    );
  });

  it("filters by category when provided", async () => {
    (prisma.userFeedback.findMany as jest.Mock).mockResolvedValue([mockFeedback()]);
    await FeedbackService.getFeedbackItems(USER_ID, { category: "ui" });
    expect(prisma.userFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category: "ui" }),
      })
    );
  });

  it("filters by status when provided", async () => {
    (prisma.userFeedback.findMany as jest.Mock).mockResolvedValue([mockFeedback()]);
    await FeedbackService.getFeedbackItems(USER_ID, { status: "resolved" });
    expect(prisma.userFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "resolved" }),
      })
    );
  });

  it("filters by priority when provided", async () => {
    (prisma.userFeedback.findMany as jest.Mock).mockResolvedValue([mockFeedback()]);
    await FeedbackService.getFeedbackItems(USER_ID, { priority: "critical" });
    expect(prisma.userFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ priority: "critical" }),
      })
    );
  });

  it("respects limit parameter", async () => {
    (prisma.userFeedback.findMany as jest.Mock).mockResolvedValue([mockFeedback()]);
    await FeedbackService.getFeedbackItems(USER_ID, {}, 10);
    expect(prisma.userFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 })
    );
  });
});

// ── FeedbackService.getUserFeedback tests ─────────────────────────────────────
describe("FeedbackService.getUserFeedback", () => {
  beforeEach(resetMocks);

  it("returns feedback for a specific user ordered by created_at desc", async () => {
    (prisma.userFeedback.findMany as jest.Mock).mockResolvedValue([
      mockFeedback({ created_at: new Date("2025-03-01") }),
      mockFeedback({ id: FEEDBACK_ID_2, created_at: new Date("2025-03-02") }),
    ]);

    const result = await FeedbackService.getUserFeedback(USER_ID);
    expect(prisma.userFeedback.findMany).toHaveBeenCalledWith({
      where: { user_id: USER_ID },
      orderBy: { created_at: "desc" },
    });
    expect(result).toHaveLength(2);
  });

  it("returns empty array when user has no feedback", async () => {
    (prisma.userFeedback.findMany as jest.Mock).mockResolvedValue([]);

    const result = await FeedbackService.getUserFeedback(USER_ID);
    expect(result).toEqual([]);
  });
});

// ── FeedbackService.getFeedbackById tests ─────────────────────────────────────
describe("FeedbackService.getFeedbackById", () => {
  beforeEach(resetMocks);

  it("returns feedback for admin user", async () => {
    mockAdminUserIds.push(ADMIN_ID);
    (prisma.userFeedback.findUnique as jest.Mock).mockResolvedValue(
      mockFeedback({ user_id: USER_ID })
    );

    const result = await FeedbackService.getFeedbackById(ADMIN_ID, FEEDBACK_ID);
    expect(result).toBeDefined();
    expect(result.id).toBe(FEEDBACK_ID);
  });

  it("returns feedback for the owner", async () => {
    (prisma.userFeedback.findUnique as jest.Mock).mockResolvedValue(
      mockFeedback({ user_id: USER_ID })
    );

    const result = await FeedbackService.getFeedbackById(USER_ID, FEEDBACK_ID);
    expect(result).toBeDefined();
    expect(result.id).toBe(FEEDBACK_ID);
  });

  it("throws 403 when non-admin user tries to access another user's feedback", async () => {
    (prisma.userFeedback.findUnique as jest.Mock).mockResolvedValue(
      mockFeedback({ user_id: "other-user" })
    );

    await expect(
      FeedbackService.getFeedbackById(USER_ID, FEEDBACK_ID)
    ).rejects.toThrow("Unauthorized access to feedback");
  });

  it("returns null when feedback does not exist", async () => {
    (prisma.userFeedback.findUnique as jest.Mock).mockResolvedValue(null);

    const result = await FeedbackService.getFeedbackById(USER_ID, "nonexistent");
    expect(result).toBeNull();
  });
});

// ── FeedbackService.updateFeedbackStatus tests ────────────────────────────────
describe("FeedbackService.updateFeedbackStatus", () => {
  beforeEach(resetMocks);

  it("updates status for admin user", async () => {
    mockAdminUserIds.push(ADMIN_ID);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: ADMIN_ID,
      user_role: "admin",
      email: "admin@colabwize.com",
    });
    (prisma.userFeedback.update as jest.Mock).mockResolvedValue(
      mockFeedback({ status: "resolved" })
    );

    const result = await FeedbackService.updateFeedbackStatus(
      ADMIN_ID,
      FEEDBACK_ID,
      "resolved",
      "Fixed in v2.0"
    );

    expect(prisma.userFeedback.update).toHaveBeenCalledWith({
      where: { id: FEEDBACK_ID },
      data: {
        status: "resolved",
        admin_notes: "Fixed in v2.0",
        resolved_at: expect.anything(),
      },
    });
    expect(result.status).toBe("resolved");
  });

  it("sets resolved_at when status is resolved", async () => {
    mockAdminUserIds.push(ADMIN_ID);
    (prisma.userFeedback.update as jest.Mock).mockResolvedValue(mockFeedback());

    await FeedbackService.updateFeedbackStatus(
      ADMIN_ID,
      FEEDBACK_ID,
      "resolved"
    );

    const updateCall = (prisma.userFeedback.update as jest.Mock).mock.calls[0];
    expect(updateCall[0].data.resolved_at).toBeDefined();
  });

  it("sets resolved_at when status is closed", async () => {
    mockAdminUserIds.push(ADMIN_ID);
    (prisma.userFeedback.update as jest.Mock).mockResolvedValue(mockFeedback());

    await FeedbackService.updateFeedbackStatus(
      ADMIN_ID,
      FEEDBACK_ID,
      "closed"
    );

    const updateCall = (prisma.userFeedback.update as jest.Mock).mock.calls[0];
    expect(updateCall[0].data.resolved_at).toBeDefined();
  });

  it("throws for non-admin users", async () => {
    await expect(
      FeedbackService.updateFeedbackStatus(
        USER_ID,
        FEEDBACK_ID,
        "resolved"
      )
    ).rejects.toThrow("Only administrators can update feedback status");
  });
});

// ── FeedbackService.addFeedbackComment tests ───────────────────────────────────
describe("FeedbackService.addFeedbackComment", () => {
  beforeEach(resetMocks);

  it("adds a public comment to feedback", async () => {
    (prisma.userFeedback.findUnique as jest.Mock).mockResolvedValue(
      mockFeedback({ user_id: USER_ID })
    );

    const result = await FeedbackService.addFeedbackComment(USER_ID, FEEDBACK_ID, {
      user_id: USER_ID,
      content: "Thanks for this feedback!",
      is_internal: false,
    });

    expect(prisma.feedbackComment.create).toHaveBeenCalledWith({
      data: {
        feedback_id: FEEDBACK_ID,
        user_id: USER_ID,
        content: "Thanks for this feedback!",
        is_internal: false,
      },
    });
    expect(result).toBeDefined();
  });

  it("adds an internal comment as admin", async () => {
    mockAdminUserIds.push(ADMIN_ID);
    (prisma.userFeedback.findUnique as jest.Mock).mockResolvedValue(
      mockFeedback({ user_id: USER_ID })
    );

    await FeedbackService.addFeedbackComment(
      ADMIN_ID,
      FEEDBACK_ID,
      {
        user_id: ADMIN_ID,
        content: "Note to self: follow up",
        is_internal: true,
      }
    );

    expect(prisma.feedbackComment.create).toHaveBeenCalledWith({
      data: {
        feedback_id: FEEDBACK_ID,
        user_id: ADMIN_ID,
        content: "Note to self: follow up",
        is_internal: true,
      },
    });
  });

  it("does not allow non-admin to create internal comments", async () => {
    (prisma.userFeedback.findUnique as jest.Mock).mockResolvedValue(
      mockFeedback({ user_id: USER_ID })
    );

    await FeedbackService.addFeedbackComment(USER_ID, FEEDBACK_ID, {
      user_id: USER_ID,
      content: "This shouldn't be internal",
      is_internal: true,
    });

    const createCall = (prisma.feedbackComment.create as jest.Mock).mock.calls[0];
    expect(createCall[0].data.is_internal).toBe(false);
  });

  it("throws when feedback does not exist", async () => {
    (prisma.userFeedback.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      FeedbackService.addFeedbackComment(USER_ID, "nonexistent", {
        user_id: USER_ID,
        content: "Hello",
        is_internal: false,
      })
    ).rejects.toThrow("Feedback not found");
  });

  it("throws for unauthorized comment", async () => {
    (prisma.userFeedback.findUnique as jest.Mock).mockResolvedValue(
      mockFeedback({ user_id: "other-user" })
    );

    await expect(
      FeedbackService.addFeedbackComment(USER_ID, FEEDBACK_ID, {
        user_id: USER_ID,
        content: "Hello",
        is_internal: false,
      })
    ).rejects.toThrow("Unauthorized to comment on this feedback");
  });
});

// ── FeedbackService.getFeedbackComments tests ─────────────────────────────────
describe("FeedbackService.getFeedbackComments", () => {
  beforeEach(resetMocks);

  it("returns public comments for owner", async () => {
    (prisma.userFeedback.findUnique as jest.Mock).mockResolvedValue(
      mockFeedback({ user_id: USER_ID })
    );
    (prisma.feedbackComment.findMany as jest.Mock).mockResolvedValue([
      mockComment(),
    ]);

    const result = await FeedbackService.getFeedbackComments(USER_ID, FEEDBACK_ID);
    expect(result).toHaveLength(1);
    expect(result[0].is_internal).toBe(false);
  });

  it("includes internal comments for admin with includeInternal=true", async () => {
    mockAdminUserIds.push(ADMIN_ID);
    (prisma.userFeedback.findUnique as jest.Mock).mockResolvedValue(
      mockFeedback({ user_id: USER_ID })
    );
    (prisma.feedbackComment.findMany as jest.Mock).mockResolvedValue([
      mockComment({ is_internal: true }),
    ]);

    const result = await FeedbackService.getFeedbackComments(
      ADMIN_ID,
      FEEDBACK_ID,
      true
    );
    expect(result[0].is_internal).toBe(true);
    expect(prisma.feedbackComment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { feedback_id: FEEDBACK_ID },
      })
    );
  });

  it("excludes internal comments for non-admin users", async () => {
    (prisma.userFeedback.findUnique as jest.Mock).mockResolvedValue(
      mockFeedback({ user_id: USER_ID })
    );

    await FeedbackService.getFeedbackComments(USER_ID, FEEDBACK_ID);
    const findManyCall = (prisma.feedbackComment.findMany as jest.Mock).mock
      .calls[0][0];
    expect(findManyCall.where.is_internal).toBe(false);
  });

  it("throws for unauthorized access", async () => {
    (prisma.userFeedback.findUnique as jest.Mock).mockResolvedValue(
      mockFeedback({ user_id: "other-user" })
    );

    await expect(
      FeedbackService.getFeedbackComments(USER_ID, FEEDBACK_ID)
    ).rejects.toThrow("Unauthorized to view comments on this feedback");
  });

  it("throws when feedback does not exist", async () => {
    (prisma.userFeedback.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      FeedbackService.getFeedbackComments(USER_ID, "nonexistent")
    ).rejects.toThrow("Feedback not found");
  });
});

// ── FeedbackService.getFeedbackStats tests ──────────────────────────────────────
describe("FeedbackService.getFeedbackStats", () => {
  beforeEach(resetMocks);

  it("returns stats for admin user", async () => {
    mockAdminUserIds.push(ADMIN_ID);
    (prisma.userFeedback.count as jest.Mock)
      .mockResolvedValueOnce(100) // total
      .mockResolvedValueOnce(30) // open
      .mockResolvedValueOnce(40) // in_progress
      .mockResolvedValueOnce(30); // resolved
    (prisma.userFeedback.groupBy as jest.Mock)
      .mockResolvedValueOnce([
        { type: "feedback", _count: { _all: 50 } },
        { type: "bug_report", _count: { _all: 30 } },
        { type: "feature_request", _count: { _all: 20 } },
      ])
      .mockResolvedValueOnce([
        { category: "general", _count: { _all: 40 } },
        { category: "ui", _count: { _all: 30 } },
      ]);

    const result = await FeedbackService.getFeedbackStats(ADMIN_ID);
    expect(result).toMatchObject({
      total: 100,
      open: 30,
      inProgress: 40,
      resolved: 30,
      byType: expect.any(Array),
      byCategory: expect.any(Array),
    });
  });

  it("throws for non-admin users", async () => {
    await expect(
      FeedbackService.getFeedbackStats(USER_ID)
    ).rejects.toThrow("Only administrators can view feedback statistics");
  });
});

// ── API Route Integration Tests ────────────────────────────────────────────────

/**
 * The route tests use supertest to validate the Express router behavior.
 * We mock the FeedbackService to focus on route-level validation, auth,
 * and response formatting.
 */
jest.mock("../src/services/feedbackService", () => ({
  FeedbackService: {
    isUserAdmin: jest.fn().mockResolvedValue(false),
    createFeedback: jest.fn().mockResolvedValue(mockFeedback()),
    getFeedbackItems: jest.fn().mockResolvedValue([mockFeedback()]),
    getUserFeedback: jest.fn().mockResolvedValue([mockFeedback()]),
    getFeedbackById: jest.fn().mockResolvedValue(mockFeedback()),
    updateFeedbackStatus: jest.fn().mockResolvedValue(mockFeedback()),
    addFeedbackComment: jest.fn().mockResolvedValue(mockComment()),
    getFeedbackComments: jest.fn().mockResolvedValue([mockComment()]),
    getFeedbackStats: jest.fn().mockResolvedValue({
      total: 1,
      open: 1,
      inProgress: 0,
      resolved: 0,
      byType: [],
      byCategory: [],
    }),
  },
}));

import request from "supertest";
import express from "express";
import feedbackRouter from "../src/api/feedback/route";

// Apply the auth mock to our test app
function createTestApp(testUserId: string | null = USER_ID) {
  const app = express();
  app.use(express.json());
  // Inline auth middleware that mimics authenticateExpressRequest
  app.use((req: any, _res, next) => {
    if (testUserId) {
      req.user = { id: testUserId, email: "user@example.com", user_role: "user" };
    }
    next();
  });
  app.use("/api/feedback", feedbackRouter);
  return app;
}

describe("Feedback API routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/feedback/public", () => {
    it("creates public feedback with feature_request type", async () => {
      const app = createTestApp(null); // no auth needed for public endpoint
      const response = await request(app)
        .post("/api/feedback/public")
        .send({
          type: "feature_request",
          title: "Add dark mode",
          description: "Would love a dark theme option",
          priority: "medium",
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.feedback).toBeDefined();
    });

    it("rejects non-feature_request types on public endpoint", async () => {
      const app = createTestApp(null);
      const response = await request(app)
        .post("/api/feedback/public")
        .send({
          type: "bug_report",
          title: "Something is broken",
          description: "Test",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("Public endpoint only accepts");
    });

    it("validates required fields", async () => {
      const app = createTestApp(null);
      const response = await request(app)
        .post("/api/feedback/public")
        .send({
          type: "feature_request",
          title: "",
          description: "",
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("required");
    });

    it("validates feedback type", async () => {
      const app = createTestApp(null);
      const response = await request(app)
        .post("/api/feedback/public")
        .send({
          type: "invalid_type",
          title: "Test",
          description: "Test",
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Invalid feedback type");
    });

    it("validates priority", async () => {
      const app = createTestApp(null);
      const response = await request(app)
        .post("/api/feedback/public")
        .send({
          type: "feature_request",
          title: "Test",
          description: "Test",
          priority: "invalid_priority",
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Invalid priority level");
    });
  });

  describe("POST /api/feedback", () => {
    it("creates feedback with user_id", async () => {
      const app = createTestApp(USER_ID);
      const response = await request(app)
        .post("/api/feedback")
        .send({
          type: "bug_report",
          title: "Bug found",
          description: "Something is not working",
          priority: "high",
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(
        FeedbackService.createFeedback
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "bug_report",
          title: "Bug found",
          user_id: USER_ID,
        })
      );
    });

    it("validates required fields", async () => {
      const app = createTestApp(USER_ID);
      const response = await request(app)
        .post("/api/feedback")
        .send({
          type: "feedback",
          title: "Missing description",
          description: "",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("returns 401 when not authenticated", async () => {
      const app = createTestApp(null);
      const response = await request(app)
        .post("/api/feedback")
        .send({
          type: "feedback",
          title: "Test",
          description: "Test",
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("not authenticated");
    });
  });

  describe("GET /api/feedback", () => {
    it("returns feedback items for authenticated user", async () => {
      (FeedbackService.getFeedbackItems as jest.Mock).mockResolvedValue([
        mockFeedback(),
        mockFeedback({ id: FEEDBACK_ID_2 }),
      ]);

      const app = createTestApp(USER_ID);
      const response = await request(app).get("/api/feedback");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.feedback).toHaveLength(2);
    });

    it("passes filters as query parameters", async () => {
      const app = createTestApp(USER_ID);
      await request(app)
        .get("/api/feedback?type=bug_report&category=ui&status=open&limit=10")
        .expect(200);

      expect(FeedbackService.getFeedbackItems).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({
          type: "bug_report",
          category: "ui",
          status: "open",
        }),
        10
      );
    });

    it("returns 401 when not authenticated", async () => {
      const app = createTestApp(null);
      const response = await request(app).get("/api/feedback");

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/feedback/my", () => {
    it("returns user's own feedback", async () => {
      (FeedbackService.getUserFeedback as jest.Mock).mockResolvedValue([
        mockFeedback(),
      ]);

      const app = createTestApp(USER_ID);
      const response = await request(app).get("/api/feedback/my");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.feedback).toHaveLength(1);
      expect(FeedbackService.getUserFeedback).toHaveBeenCalledWith(USER_ID);
    });
  });

  describe("GET /api/feedback/:id", () => {
    it("returns a specific feedback item", async () => {
      (FeedbackService.getFeedbackById as jest.Mock).mockResolvedValue(
        mockFeedback()
      );

      const app = createTestApp(USER_ID);
      const response = await request(app).get(`/api/feedback/${FEEDBACK_ID}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.feedback).toBeDefined();
      expect(FeedbackService.getFeedbackById).toHaveBeenCalledWith(
        USER_ID,
        FEEDBACK_ID
      );
    });

    it("returns 404 when feedback not found", async () => {
      (FeedbackService.getFeedbackById as jest.Mock).mockResolvedValue(null);

      const app = createTestApp(USER_ID);
      const response = await request(app).get("/api/feedback/nonexistent");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("not found");
    });

    it("returns 403 when unauthorized", async () => {
      (FeedbackService.getFeedbackById as jest.Mock).mockRejectedValue(
        new Error("Unauthorized access to feedback")
      );

      const app = createTestApp(USER_ID);
      const response = await request(app).get(`/api/feedback/${FEEDBACK_ID}`);

      expect(response.status).toBe(403);
      expect(response.body.message).toBe("Access denied");
    });
  });

  describe("PATCH /api/feedback/:id/status", () => {
    it("updates status as admin", async () => {
      (FeedbackService.isUserAdmin as jest.Mock).mockResolvedValue(true);
      (FeedbackService.updateFeedbackStatus as jest.Mock).mockResolvedValue(
        mockFeedback({ status: "resolved" })
      );

      const app = createTestApp(ADMIN_ID);
      const response = await request(app)
        .patch(`/api/feedback/${FEEDBACK_ID}/status`)
        .send({ status: "resolved", adminNotes: "Fixed in v2.0" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(FeedbackService.updateFeedbackStatus).toHaveBeenCalledWith(
        ADMIN_ID,
        FEEDBACK_ID,
        "resolved",
        "Fixed in v2.0"
      );
    });

    it("returns 400 when status is missing", async () => {
      const app = createTestApp(ADMIN_ID);
      const response = await request(app)
        .patch(`/api/feedback/${FEEDBACK_ID}/status`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("Status is required");
    });

    it("returns 400 for invalid status", async () => {
      const app = createTestApp(ADMIN_ID);
      const response = await request(app)
        .patch(`/api/feedback/${FEEDBACK_ID}/status`)
        .send({ status: "invalid_status" });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Invalid status");
    });
  });

  describe("POST /api/feedback/:id/comments", () => {
    it("adds a comment to feedback", async () => {
      (FeedbackService.addFeedbackComment as jest.Mock).mockResolvedValue(
        mockComment()
      );

      const app = createTestApp(USER_ID);
      const response = await request(app)
        .post(`/api/feedback/${FEEDBACK_ID}/comments`)
        .send({ content: "Great feedback!" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(FeedbackService.addFeedbackComment).toHaveBeenCalledWith(
        USER_ID,
        FEEDBACK_ID,
        expect.objectContaining({ content: "Great feedback!" })
      );
    });

    it("returns 400 when comment content is missing", async () => {
      const app = createTestApp(USER_ID);
      const response = await request(app)
        .post(`/api/feedback/${FEEDBACK_ID}/comments`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("Comment content is required");
    });
  });

  describe("GET /api/feedback/:id/comments", () => {
    it("returns comments for a feedback item", async () => {
      (FeedbackService.getFeedbackComments as jest.Mock).mockResolvedValue([
        mockComment(),
      ]);

      const app = createTestApp(USER_ID);
      const response = await request(app).get(
        `/api/feedback/${FEEDBACK_ID}/comments`
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.comments).toHaveLength(1);
    });

    it("checks admin status for internal comments", async () => {
      (FeedbackService.isUserAdmin as jest.Mock).mockResolvedValue(true);
      (FeedbackService.getFeedbackComments as jest.Mock).mockResolvedValue([]);

      const app = createTestApp(ADMIN_ID);
      await request(app).get(
        `/api/feedback/${FEEDBACK_ID}/comments?include_internal=true`
      );

      expect(FeedbackService.isUserAdmin).toHaveBeenCalledWith(ADMIN_ID);
    });
  });

  describe("GET /api/feedback/stats/summary", () => {
    it("returns stats for admin user", async () => {
      (FeedbackService.isUserAdmin as jest.Mock).mockResolvedValue(true);
      (FeedbackService.getFeedbackStats as jest.Mock).mockResolvedValue({
        total: 10,
        open: 5,
        inProgress: 3,
        resolved: 2,
        byType: [],
        byCategory: [],
      });

      const app = createTestApp(ADMIN_ID);
      const response = await request(app).get("/api/feedback/stats/summary");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.stats).toMatchObject({
        total: 10,
        open: 5,
        inProgress: 3,
        resolved: 2,
      });
    });

    it("returns 403 for non-admin users", async () => {
      (FeedbackService.isUserAdmin as jest.Mock).mockResolvedValue(false);
      (FeedbackService.getFeedbackStats as jest.Mock).mockRejectedValue(
        new Error("Only administrators can view feedback statistics")
      );

      const app = createTestApp(USER_ID);
      const response = await request(app).get("/api/feedback/stats/summary");

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(
        "Access denied. Admin privileges required."
      );
    });
  });
});
