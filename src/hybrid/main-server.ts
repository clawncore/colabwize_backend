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
import imageRouter from "../api/images/upload";
import { initializeSubscriptionJobs } from "../jobs/subscriptionJobs";

const app: Application = express();
// Port assignment moved to startServer function
// Force server restart for Prisma Client update

// Middleware
// Robust CORS Configuration
const allowedOrigins = [
  "https://colabwize.com",
  "https://app.colabwize.com",
  "https://api.colabwize.com",
  "http://localhost:3000",
  "http://localhost:5173",
  /\.vercel\.app$/
];

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.some(o =>
      typeof o === "string" ? o === origin : o.test(origin)
    )) {
      return callback(null, true);
    }

    // Log blocked origins for debugging
    console.log(`[CORS] Blocked request from origin: ${origin}`);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  maxAge: 86400 // Cache preflight response for 24 hours
};

// Apply CORS middleware globally BEFORE all routes
app.use(cors(corsOptions));

// Explicitly handle OPTIONS preflight for all routes
app.options("*", cors(corsOptions));

app.use(express.json({ limit: "50mb" }));

// Debug middleware
// Request Instrumentation Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  // Attach start time to request
  (req as any).startTime = Date.now();
  (req as any).authTime = 0; // Will be populated by auth middleware

  // Log request start
  // console.log(`[REQ] ${req.method} ${req.url}`);

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
      is_slow: duration > 500
    });

    // Console output for immediate visibility
    if (duration > 300) {
      console.log(`[PERF][SLOW] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms (Auth: ${authTime}ms)`);
    } else {
      console.log(`[PERF] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms (Auth: ${authTime}ms)`);
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
      setTimeout(() => reject(new Error("DB_TIMEOUT")), 200)
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
      logger.error("Health check - DB Connection Failed", { error: error.message });
    }

    // Return 200 OK so Render doesn't kill the container during startup/transient issues
    res.status(200).json({
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: isTimeout ? "Slow/Initializing" : "Disconnected",
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

// Images API (Upload to Supabase)
app.use("/api/images", authMiddleware, imageRouter);

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

        // [DIAGNOSTICS] Pre-connection Network Check
        try {
          const dbUrl = process.env.DATABASE_URL;
          if (dbUrl) {
            const url = new URL(dbUrl);
            const dns = require('dns').promises;
            const net = require('net');

            logger.info(`🔍 [Diagnostics] Resolving DNS for: ${url.hostname}`);
            const addresses = await dns.lookup(url.hostname).catch((e: any) => {
              logger.error(`❌ [Diagnostics] DNS Lookup Failed: ${e.message}`);
              return null;
            });

            if (addresses) {
              logger.info(`✅ [Diagnostics] Resolved IP: ${addresses.address}`);

              logger.info(`🔍 [Diagnostics] Testing TCP connection to ${url.hostname}:${url.port}...`);
              await new Promise<void>((resolve, reject) => {
                const socket = new net.Socket();
                socket.setTimeout(5000);

                socket.on('connect', () => {
                  logger.info(`✅ [Diagnostics] TCP Connection Successful to ${url.hostname}:${url.port}`);
                  socket.destroy();
                  resolve();
                });

                socket.on('timeout', () => {
                  logger.error(`❌ [Diagnostics] TCP Connection Timed Out`);
                  socket.destroy();
                  reject(new Error("TCP Timeout"));
                });

                socket.on('error', (err: any) => {
                  logger.error(`❌ [Diagnostics] TCP Connection Error: ${err.message}`);
                  socket.destroy();
                  reject(err);
                });

                socket.connect(Number(url.port), url.hostname);
              }).catch(() => { /* error already logged */ });
            }
          }
        } catch (diagError) {
          logger.warn("⚠️ [Diagnostics] Failed to run network checks:", diagError);
        }

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
