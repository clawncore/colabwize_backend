import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import logger from "../monitoring/logger";
import { authenticateExpressRequest } from "../middleware/auth";
import { RecycleBinService } from "../services/recycleBinService";
import { SecretsService } from "../services/secrets-service";
import { initializePrisma } from "../lib/prisma-async";

// Load environment variables
dotenv.config();

// Import routers
import authRouter from "../api/auth/index";
import surveyRouter from "../api/survey/index";
import originalityRouter from "../api/originality/index";
import citationsRouter from "../api/citations/index";

import authorshipRouter from "../api/authorship/index";
import analyticsRouter from "../api/analytics/index";
import subscriptionRouter from "../api/subscription/index";
import webhookRouter from "../api/webhooks/lemonsqueezy";
import usersRouter from "../api/users/index";
import documentUploadRouter from "../api/documents/documentUpload";
import fileProcessingRouter from "../api/files/fileProcessing";
import projectsRouter from "../api/projects/projects";
import recyclebinRouter from "../api/recyclebin/route";
import feedbackRouter from "../api/feedback/index";
import supportTicketRouter from "../api/support-ticket/index";
import featureRequestRouter from "../api/feature-request/index";
import contactRouter from "../api/contact/index";
import onboardingRouter from "../api/onboarding/index";
import chatRouter from "../api/chat/index";
import waitlistRouter from "../api/waitlist/index";
import { initializeSubscriptionJobs } from "../jobs/subscriptionJobs";

const app: Application = express();
// Port assignment moved to startServer function
// Force server restart for Prisma Client update

// Middleware
app.use(
  cors({
    origin: async (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      const frontendUrl = await SecretsService.getFrontendUrl();
      // Get Allowed Origins from secrets service
      const allowedOriginsStr = await SecretsService.getAllowedOrigins();
      const extraOrigins = allowedOriginsStr
        ? allowedOriginsStr.split(",")
        : [];

      const allowedOrigins = [
        frontendUrl,
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://localhost:3003",
        "http://localhost:3004",
        "http://localhost:3005",
        "http://localhost:5173",
        "http://localhost:4173",
        "http://127.0.0.1:3000",
        ...extraOrigins,
      ].filter(Boolean) as string[];

      if (
        allowedOrigins.indexOf(origin) !== -1 ||
        (await SecretsService.getNodeEnv()) === "development"
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "50mb" }));

// Debug middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
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
app.get("/health", async (req, res) => {
  try {
    const prisma = await initializePrisma();
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      services: {
        database: "Connected",
        auth: "Supabase Auth",
      },
    });
  } catch (error: any) {
    logger.error("Health check - DB Connection Failed", { error: error.message });
    // Return 200 OK so Render doesn't kill the container during startup/transient issues
    // The application can still serve other requests (e.g. static files, or webhooks)
    res.status(200).json({
      status: "DEGRADED",
      timestamp: new Date().toISOString(),
      services: {
        database: "Disconnected",
        error: error.message
      }
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

// Mount routers with authentication
const authMiddleware = authenticateExpressRequest;

// Auth API (No authentication required for login/register)
app.use("/api/auth", authRouter);

// Survey API (Authentication required)
app.use("/api/survey", authMiddleware, surveyRouter);

// Originality Map API (MVP Feature #1)
app.use("/api/originality", authMiddleware, originalityRouter);

// Citations API (MVP Feature #2 - Citation Confidence + Missing Link)
app.use("/api/citations", authMiddleware, citationsRouter);

// Authorship Certificate API (MVP Feature #4)
app.use("/api/authorship", authMiddleware, authorshipRouter);

// Analytics API
app.use("/api/analytics", authMiddleware, analyticsRouter);

// Subscription API
app.use("/api/subscription", subscriptionRouter);

// Document Upload API (MVP Core Feature)
app.use("/api/documents", authMiddleware, documentUploadRouter);

// File Processing API (Import/Export)
app.use("/api/files", authMiddleware, fileProcessingRouter);

// Users API (Authentication required)
app.use("/api/users", authMiddleware, usersRouter);

// Webhooks (no auth)
app.use("/api/webhooks", webhookRouter);

app.use("/api/projects", authMiddleware, projectsRouter);

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
  try {
    console.log("🚀 Starting server initialization...");
    const PORT = Number(process.env.PORT) || 10000;

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

  } catch (error: any) {
    console.error("❌ Failed to start server:", error);
    logger.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

export default app;
