import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import logger from "../monitoring/logger";
import { authenticateExpressRequest } from "../middleware/auth";
import { RecycleBinService } from "../services/recycleBinService";
import { SecretsService } from "../services/secrets-service";

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
    const { prisma } = await import("../lib/prisma");
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      services: {
        database: "PostgreSQL",
        auth: "Supabase Auth",
      },
    });
  } catch (error: any) {
    logger.error("Health check failed", { error: error.message });
    res.status(500).json({
      status: "ERROR",
      timestamp: new Date().toISOString(),
      error: error.message,
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

// Initialize recycle bin cleanup scheduler
RecycleBinService.scheduleCleanup();

// Initialize subscription cron jobs (certificate cleanup & usage reset)
initializeSubscriptionJobs();

// Start server
// Start server
const startServer = async () => {
  const PORT = await SecretsService.getPort();
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`✅ Health check: http://localhost:${PORT}/health`);
    console.log(`✅ Originality API: http://localhost:${PORT}/api/originality`);
  });
};

startServer();

export default app;
