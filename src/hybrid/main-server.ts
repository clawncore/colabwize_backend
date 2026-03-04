// Server Entry Point - Triggering Restart...
import dotenv from "dotenv";
// Load environment variables immediately
dotenv.config();

import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import logger from "../monitoring/logger";
import { authenticateExpressRequest } from "../middleware/auth";
import { RecycleBinService } from "../services/recycleBinService";
import { SecretsService } from "../services/secrets-service";
import { initializePrisma } from "../lib/prisma-async";
import {
  apiLimiter,
  authLimiter,
  uploadLimiter,
} from "../middleware/rateLimiter";

import { scheduleCleanupTask } from "../scheduledTasks/cleanupExpiredItems";
import { scheduleVersionCleanupTask } from "../scheduledTasks/versionCleanupTask";
import { scheduleSearchAlertsTask } from "../scheduledTasks/checkSearchAlerts";
import { scheduleVersionSchedulingTask } from "../scheduledTasks/versionSchedulingTask";
import { scheduleTaskReminderTask } from "../scheduledTasks/taskReminderTask";
import { getNotificationServer } from "../lib/notificationServer";
import grammarRouter from "../api/grammar/index";
// Import collaboration server
import { HocuspocusCollaborationServer } from "./websockets/hocuspocus-server";

// Import routers
import authRouter from "../api/auth/index";
import surveyRouter from "../api/survey/index";
import originalityRouter from "../api/originality/index";
import citationsRouter from "../api/citations/index";
import annotationsRouter from "../api/annotations/index";
import notificationsRouter from "../api/notifications/index";
import teamChatRouter from "../api/team-chat/index";
import pdfRouter from "../api/pdf/index";
import workspacesRouter from "../api/workspaces/index";
import authorshipRouter from "../api/authorship/index";
import aiDetectionRouter from "../api/ai-detection/index";
import analyticsRouter from "../api/analytics/index";
import subscriptionRouter from "../api/subscription/index";
import webhookRouter from "../api/webhooks/lemonsqueezy";
import usersRouter from "../api/users/index";
import documentUploadRouter from "../api/documents/documentUpload";
import fileProcessingRouter from "../api/files/fileProcessing";
import projectsRouter from "../api/projects/projects";
import editorRouter from "../api/editor/index";
import recyclebinRouter from "../api/recyclebin/route";
import feedbackRouter from "../api/feedback/index";
import supportTicketRouter from "../api/support-ticket/index";
import featureRequestRouter from "../api/feature-request/index";
import contactRouter from "../api/contact/index";
import onboardingRouter from "../api/onboarding/index";
import chatRouter from "../api/chat/index";
import waitlistRouter from "../api/waitlist/index";
import imageRouter from "../api/images/upload";
import templatesRouter from "../api/templates/index";
import workspaceTemplatesRouter from "../api/workspace-templates/index";
import behavioralTrackingRouter from "../api/behavioral-tracking/index";
import proxyRouter from "../api/proxy/index";
import sourcesRouter from "../api/sources/index";
import unsplashRouter from "../api/integrations/unsplash";
import searchAlertsRouter from "../api/search-alerts/index";
import researchRouter from "../api/research/index";
import { initializeSubscriptionJobs } from "../jobs/subscriptionJobs";
import { initializeSearchAlertJobs } from "../jobs/searchAlertJobs";

const app: Application = express();

// Start Scheduled Tasks
scheduleSearchAlertsTask();
scheduleCleanupTask();
scheduleVersionCleanupTask();
scheduleVersionSchedulingTask();
scheduleTaskReminderTask();

app.set("trust proxy", true);

// Middleware
// Robust CORS Configuration
const allowedOrigins = [
  "https://colabwize.com",
  "https://colabwize.com/",
  "https://www.colabwize.com",
  "https://www.colabwize.com/",
  "https://app.colabwize.com",
  "https://app.colabwize.com/",
  "https://api.colabwize.com",
  "https://api.colabwize.com/",
  "http://localhost:3000",
  "http://localhost:3000/",
  "http://localhost:3001",
  "http://localhost:3001/",
  "http://localhost:5173",
  "http://localhost:5173/",
  /\.vercel\.app$/,
];

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (
      allowedOrigins.some((o) =>
        typeof o === "string" ? o === origin : o.test(origin),
      )
    ) {
      return callback(null, true);
    }

    // Log blocked origins for debugging
    console.log(`[CORS] Blocked request from origin: ${origin}`);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "x-auth-organic",
    "x-auth-otp-method",
  ],
  maxAge: 86400, // Cache preflight response for 24 hours
};

// Apply CORS middleware globally BEFORE all routes
app.use(cors(corsOptions));

// Explicitly handle OPTIONS preflight for all routes
app.options("*", cors(corsOptions));

// Webhooks MUST be registered BEFORE global express.json to get raw body
// Important for signature verification (LemonSqueezy, etc.)
app.use("/api/webhooks", webhookRouter);

app.use(
  express.json({
    limit: "50mb",
    verify: (req: any, res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// Apply Global API Rate Limiter
// Stops generic abuse/scraping
app.use(apiLimiter);

// Debug middleware
// Request Instrumentation Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  // Attach start time to request
  (req as any).startTime = Date.now();
  (req as any).authTime = 0; // Will be populated by auth middleware

  // Log request start
  console.log(`[ENTRY] ${req.method} ${req.url}`);

  // Log response time on finish
  res.on("finish", () => {
    const duration = Date.now() - (req as any).startTime;
    const authTime = (req as any).authTime || 0;
    const dbTime = (req as any).dbTime || 0; // Placeholder if we implement ALS later
    const processingTime = duration - authTime - dbTime;

    const logLevel = duration > 500 ? "warn" : "info";

    // Structured performance log
    logger.log(logLevel, "Request Performance", {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      total_ms: duration,
      auth_ms: authTime,
      processing_ms: processingTime,
      is_slow: duration > 500,
    });

    // Console output for immediate visibility
    if (duration > 300) {
      console.log(
        `[PERF][SLOW] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms (Auth: ${authTime}ms)`,
      );
    } else {
      console.log(
        `[PERF] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms (Auth: ${authTime}ms)`,
      );
    }
  });

  next();
});

// Error handling middleware
app.use(async (err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error("Unhandled error", {
    error: err.stack,
    url: req.url,
    method: req.method,
  });
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error:
      (await SecretsService.getNodeEnv()) === "development"
        ? err.message
        : undefined,
  });
});

// Health check endpoint
// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    // Timeout promise (200ms) to ensure strict response time
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("DB_TIMEOUT")), 200),
    );

    // Database check promise
    const dbCheck = async () => {
      // If we are still initializing, this might block, hence the timeout wrapper
      const prisma = await initializePrisma();
      await prisma.$queryRaw`SELECT 1`;
      return true;
    };

    // Race them
    await Promise.race([dbCheck(), timeout]);

    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      services: {
        database: "Connected",
        auth: "Supabase Auth",
      },
    });
  } catch (error: any) {
    const isTimeout = error.message === "DB_TIMEOUT";
    const status = isTimeout ? "WARN" : "DEGRADED";

    // Only log actual errors, not timeouts (to avoid spam if DB is slow but working)
    if (!isTimeout) {
      logger.error("Health check - DB Connection Failed", {
        error: error.message,
      });
    }

    // Return 200 OK so Render doesn't kill the container during startup/transient issues
    res.status(200).json({
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: isTimeout ? "Slow/Initializing" : "Disconnected",
        error: error.message,
      },
    });
  }
});

// API Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
  });
});

// Root handler to prevent 500/404 errors
app.get("/", (req, res) => {
  res.status(200).json({
    status: "OK",
    service: "ColabWize Backend",
    timestamp: new Date().toISOString(),
  });
});

// LibreOffice Debug Route
app.get("/debug/libreoffice", (req, res) => {
  const { exec } = require("child_process");
  exec("libreoffice --version", (err: any, stdout: string, stderr: string) => {
    if (err) {
      return res.status(500).json({ err: err.message, stderr });
    }
    res.json({ stdout, stderr });
  });
});

// Mount routers with authentication
const authMiddleware = authenticateExpressRequest;

// Auth API (No authentication required for login/register)
app.use("/api/auth", authLimiter, authRouter);

// AI Grammar Checker API
app.use("/api/grammar", authMiddleware, grammarRouter);

// Survey API (Authentication required)
app.use("/api/survey", authMiddleware, surveyRouter);

app.use("/api/workspaces", workspacesRouter);
app.use("/api/team-chat", teamChatRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/pdf", pdfRouter);

// Originality Map API (MVP Feature #1)
app.use("/api/originality", authMiddleware, originalityRouter);

// Citations API (MVP Feature #2 - Citation Confidence + Missing Link)
app.use("/api/citations", authMiddleware, citationsRouter);

// Annotations API (Feature 2: PDF Annotator)
app.use("/api/annotations", authMiddleware, annotationsRouter);

// Authorship Certificate API (MVP Feature #4)
app.use("/api/authorship", authMiddleware, authorshipRouter);

// AI Detection API
app.use("/api/ai-detection", authMiddleware, aiDetectionRouter);

// Apply auth middleware to notification routes
app.use("/api/notifications", authMiddleware);

// Mount the notifications router
app.use("/api/notifications", notificationsRouter);

// Analytics API
app.use("/api/analytics", authMiddleware, analyticsRouter);

// Subscription API
app.use("/api/subscription", subscriptionRouter);

// Document Upload API (MVP Core Feature)
app.use("/api/documents", authMiddleware, uploadLimiter, documentUploadRouter);

// File Processing API (Import/Export)
app.use("/api/files", authMiddleware, fileProcessingRouter);

// Images API (Upload to Supabase)
app.use("/api/images", authMiddleware, uploadLimiter, imageRouter);

// Behavioral Tracking API
app.use("/api/behavioral-tracking", authMiddleware, behavioralTrackingRouter);

// Users API (Authentication required)
app.use("/api/users", authMiddleware, usersRouter);

// Webhooks moved to before global express.json middleware
// Moved to line ~88 to support raw body parsing
// app.use("/api/webhooks", webhookRouter);

app.use("/api/projects", authMiddleware, projectsRouter);
app.use("/api/editor", authMiddleware, editorRouter);

// Feedback API (Authentication required for most routes, public endpoint available)
app.use("/api/feedback", feedbackRouter);

// Support Ticket API (Authentication required)
app.use("/api/support-ticket", authMiddleware, supportTicketRouter);

// Feature Request API (Some endpoints public, others require authentication)
app.use("/api/feature-request", featureRequestRouter);

// Contact API (Public)
app.use("/api/contact", contactRouter);

// Waitlist API (Public)
app.use("/api/waitlist", waitlistRouter);

// Recycle Bin API (Authentication required)
app.use("/api/recyclebin", authMiddleware, recyclebinRouter);

// Onboarding API (Authentication required)
app.use("/api/onboarding", authMiddleware, onboardingRouter);

// AI Chat API (Authentication required)
app.use("/api/chat", authMiddleware, chatRouter);

// Templates API (Authentication required)
app.use("/api/templates", authMiddleware, templatesRouter);

// Workspace Templates API (Authentication required)
app.use("/api/workspace-templates", authMiddleware, workspaceTemplatesRouter);

// Proxy API (Authentication required)
app.use("/api/proxy", authMiddleware, proxyRouter);

// Sources API (Authentication required - Source Integration Verification)
app.use("/api/sources", authMiddleware, sourcesRouter);

// Integrations API (Unsplash Proxy)
app.use("/api/integrations/unsplash", authMiddleware, unsplashRouter);

// Search Alerts API
app.use("/api/search-alerts", authMiddleware, searchAlertsRouter);

// Research Assistant API
app.use("/api/research", authMiddleware, researchRouter);

// Apply auth middleware to notification routes
app.use("/api/notifications", authMiddleware);

// Notification endpoints
app.get("/api/notifications", async (req, res) => {
  try {
    logger.info("Get notifications request");

    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Import the notification service directly
    const { getUserNotifications, getUnreadNotificationCount } =
      await import("../services/notificationService");

    // Get query parameters
    const limit = parseInt((req.query.limit as string) || "20");
    const offset = parseInt((req.query.offset as string) || "0");
    const type = (req.query.type as string) || undefined;
    const priority = req.query.priority as
      | "high"
      | "medium"
      | "low"
      | undefined;
    const search = (req.query.search as string) || undefined;
    const read = req.query.read as string;
    const readFilter = read !== undefined ? read === "true" : undefined;

    // Build filters object
    const filters = {
      type,
      priority,
      search,
      read: readFilter,
    };

    // Remove undefined values from filters

    // Removed duplicate DELETE route for projects

    Object.keys(filters).forEach(
      (key) =>
        (filters as any)[key] === undefined && delete (filters as any)[key],
    );

    // Get notifications
    const notifications = await getUserNotifications(
      userId,
      limit,
      offset,
      filters,
    );

    // Get unread count
    const unreadCount = await getUnreadNotificationCount(userId);

    return res.status(200).json({ success: true, notifications, unreadCount });
  } catch (error: any) {
    logger.error("Get notifications failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/notifications/read", async (req, res) => {
  try {
    logger.info("Mark notification as read request");

    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Import the notification service directly
    const { markNotificationAsRead } =
      await import("../services/notificationService");

    // Get notification ID from request body
    const notificationId = req.body.notificationId;
    if (!notificationId) {
      return res.status(400).json({
        success: false,
        message: "Notification ID is required",
      });
    }

    // Mark notification as read
    await markNotificationAsRead(notificationId);

    return res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error("Mark notification as read failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/notifications/dismiss", async (req, res) => {
  try {
    logger.info("Dismiss notification request");

    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Import the notification service directly
    const { dismissNotification } =
      await import("../services/notificationService");

    // Get notification ID from request body
    const notificationId = req.body.notificationId;
    if (!notificationId) {
      return res.status(400).json({
        success: false,
        message: "Notification ID is required",
      });
    }

    // Dismiss notification
    await dismissNotification(notificationId);

    return res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error("Dismiss notification failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/notifications/clear", async (req, res) => {
  try {
    logger.info("Clear notifications request");

    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Import the notification service directly
    const { markAllNotificationsAsRead } =
      await import("../services/notificationService");

    // Mark all notifications as read (since there's no clear method)
    await markAllNotificationsAsRead(userId);

    return res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error("Clear notifications failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get("/api/notifications/settings", async (req, res) => {
  try {
    logger.info("Get notification settings request");

    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Import the notification service directly
    const { getUserNotificationSettings } =
      await import("../services/notificationService");

    // Get notification settings
    const settings = await getUserNotificationSettings(userId);

    return res.status(200).json({ success: true, settings });
  } catch (error: any) {
    logger.error("Get notification settings failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.put("/api/notifications/settings", async (req, res) => {
  try {
    logger.info("Update notification settings request");

    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Import the notification service directly
    const { updateUserNotificationSettings } =
      await import("../services/notificationService");

    // Update notification settings
    const settings = await updateUserNotificationSettings(userId, req.body);

    return res.status(200).json({
      success: true,
      message: "Notification settings updated successfully",
      settings,
    });
  } catch (error: any) {
    logger.error("Update notification settings failed", {
      error: error.message,
    });
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/notifications/test", async (req, res) => {
  try {
    logger.info("Send test notification request");

    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Import the notification service directly
    const { createNotification } =
      await import("../services/notificationService");

    const { type, title, message } = req.body;

    // Create test notification
    const notification = await createNotification(
      userId,
      type as any,
      title,
      message,
    );

    return res.status(200).json({ success: true, notification });
  } catch (error: any) {
    logger.error("Send test notification failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Push notification endpoints
app.post("/api/notifications/push/register", async (req, res) => {
  try {
    logger.info("Register push notification token request");

    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Import and use the real push notification API handler
    const { POST_REGISTER } = await import("../api/notifications/push/route");

    // Get authorization header from original request
    const authHeader = req.headers.authorization;

    // Create a mock request object
    const mockRequest = {
      json: async () => req.body,
      headers: {
        authorization: authHeader,
      },
      user: { id: userId },
    };

    const response = await POST_REGISTER(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    logger.error("Register push notification token failed", {
      error: error.message,
    });
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/notifications/push/unregister", async (req, res) => {
  try {
    logger.info("Unregister push notification token request");

    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Import and use the real push notification API handler
    const { POST_UNREGISTER } = await import("../api/notifications/push/route");

    // Get authorization header from original request
    const authHeader = req.headers.authorization;

    // Create a mock request object
    const mockRequest = {
      json: async () => req.body,
      headers: {
        authorization: authHeader,
      },
      user: { id: userId },
    };

    const response = await POST_UNREGISTER(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    logger.error("Unregister push notification token failed", {
      error: error.message,
    });
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/notifications/push/test", async (req, res) => {
  try {
    logger.info("Send test push notification request");

    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Import and use the real push notification API handler
    const { POST_TEST } = await import("../api/notifications/push/route");

    // Get authorization header from original request
    const authHeader = req.headers.authorization;

    // Create a mock request object
    const mockRequest = {
      json: async () => req.body,
      headers: {
        authorization: authHeader,
      },
      user: { id: userId },
    };

    const response = await POST_TEST(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    logger.error("Send test push notification failed", {
      error: error.message,
    });
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Bulk notification operations endpoints
app.post("/api/notifications/bulk/read", async (req, res) => {
  try {
    logger.info("Bulk mark notifications as read request");

    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Import and use the real bulk notification API handler
    const { POST_READ } = await import("../api/notifications/bulk/route");

    // Get authorization header from original request
    const authHeader = req.headers.authorization;

    // Create a mock request object
    const mockRequest = {
      json: async () => req.body,
      headers: {
        authorization: authHeader,
      },
      user: { id: userId },
    };

    const response = await POST_READ(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    logger.error("Bulk mark notifications as read failed", {
      error: error.message,
    });
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/notifications/bulk/delete", async (req, res) => {
  try {
    logger.info("Bulk delete notifications request");

    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Import and use the real bulk notification API handler
    const { POST_DELETE } = await import("../api/notifications/bulk/route");

    // Get authorization header from original request
    const authHeader = req.headers.authorization;

    // Create a mock request object
    const mockRequest = {
      json: async () => req.body,
      headers: {
        authorization: authHeader,
      },
      user: { id: userId },
    };

    const response = await POST_DELETE(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    logger.error("Bulk delete notifications failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/notifications/bulk/dismiss", async (req, res) => {
  try {
    logger.info("Bulk dismiss notifications request");

    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Import and use the real bulk notification API handler
    const { POST_DISMISS } = await import("../api/notifications/bulk/route");

    // Get authorization header from original request
    const authHeader = req.headers.authorization;

    // Create a mock request object
    const mockRequest = {
      json: async () => req.body,
      headers: {
        authorization: authHeader,
      },
      user: { id: userId },
    };

    const response = await POST_DISMISS(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    logger.error("Bulk dismiss notifications failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/notifications/bulk/snooze", async (req, res) => {
  try {
    logger.info("Bulk snooze notifications request");

    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Import and use the real bulk notification API handler
    const { POST_SNOOZE } = await import("../api/notifications/bulk/route");

    // Get authorization header from original request
    const authHeader = req.headers.authorization;

    // Create a mock request object
    const mockRequest = {
      json: async () => req.body,
      headers: {
        authorization: authHeader,
      },
      user: { id: userId },
    };

    const response = await POST_SNOOZE(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    logger.error("Bulk snooze notifications failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Notification settings reset endpoint
app.post("/api/notifications/settings/reset", async (req, res) => {
  try {
    logger.info("Reset notification settings request");

    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Import and use the real notification settings reset API handler
    const { POST } = await import("../api/notifications/settings/reset/route");

    // Get authorization header from original request
    const authHeader = req.headers.authorization;

    // Create a mock request object
    const mockRequest = {
      json: async () => req.body,
      headers: {
        authorization: authHeader,
      },
      user: { id: userId },
    };

    const response = await POST(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    logger.error("Reset notification settings failed", {
      error: error.message,
    });
    return res.status(500).json({ success: false, message: error.message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Initialize recycle bin cleanup scheduler and subscription jobs inside startServer
// to ensure DB is ready and catch errors properly

// Start server
const startServer = async () => {
  // Schedule the cleanup task for expired recycle bin items
  scheduleCleanupTask();

  // Schedule the version cleanup task based on subscription plans
  scheduleVersionCleanupTask(); // Added import and function call

  try {
    console.log("🚀 Starting server initialization...");
    const PORT = Number(process.env.PORT) || 3001;

    // PRIORITY 1: Bind port immediately for Render
    const server = app.listen(PORT, "0.0.0.0", () => {
      logger.info(`Server running on port ${PORT}`);
      console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
    });

    // PRIORITY 2: Initialize Database and Services in background
    // This prevents startup timeouts if DB connection is slow
    const initServices = async () => {
      try {
        // Initialize database connection
        logger.info("Initializing database connection...");

        await initializePrisma();
        logger.info("✅ Database initialized successfully");

        // Initialize scheduled jobs
        RecycleBinService.scheduleCleanup();
        initializeSubscriptionJobs();
        initializeSearchAlertJobs();
        logger.info("✅ Scheduled jobs initialized");
      } catch (initError: any) {
        logger.error("❌ Failed to initialize services:", initError);
        console.error("❌ Critical Service Failure:", initError);
        // Optional: close server if DB is strictly required for health check to pass
        // or keep it running to serve 503s
      }
    };

    // Trigger background initialization
    initServices();

    // Initialize the task scheduler for leaderboard updates
    try {
      const scheduler = await import("../tasks/scheduler");
      logger.info("Task scheduler initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize task scheduler:", error);
    }

    // Initialize the version scheduler
    try {
      const versionScheduler =
        await import("../services/versionSchedulerService");
      versionScheduler.default.start();
      logger.info("Version scheduler initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize version scheduler:", error);
    }

    // Initialize notification WebSocket server
    try {
      const notificationServer = getNotificationServer();
      await notificationServer;
      logger.info("Notification WebSocket server initialized on port 8082");
    } catch (error) {
      logger.error(
        "Failed to initialize notification WebSocket server:",
        error,
      );
    }

    // Initialize collaboration WebSocket server (Hocuspocus)
    try {
      const collaborationServer = new HocuspocusCollaborationServer(9081);
      await collaborationServer.start();
      logger.info("WebSocket collaboration server initialized on port 9081");
    } catch (error) {
      logger.error(
        "Failed to initialize WebSocket collaboration server:",
        error,
      );
    }
  } catch (error: any) {
    console.error("❌ Failed to start server:", error);
    logger.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

export default app;
