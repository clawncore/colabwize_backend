"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportJobSystem = void 0;
// Server Entry Point - Triggering Restart...
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment variables immediately
dotenv_1.default.config();
const express_1 = __importDefault(require("express"));
const url = __importStar(require("url"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const logger_1 = __importDefault(require("../monitoring/logger"));
const auth_1 = require("../middleware/auth");
const recycleBinService_1 = require("../services/recycleBinService");
const secrets_service_1 = require("../services/secrets-service");
const prisma_async_1 = require("../lib/prisma-async");
const rateLimiter_1 = require("../middleware/rateLimiter");
const cleanupExpiredItems_1 = require("../scheduledTasks/cleanupExpiredItems");
const versionCleanupTask_1 = require("../scheduledTasks/versionCleanupTask");
const checkSearchAlerts_1 = require("../scheduledTasks/checkSearchAlerts");
const versionSchedulingTask_1 = require("../scheduledTasks/versionSchedulingTask");
const taskReminderTask_1 = require("../scheduledTasks/taskReminderTask");
const inboxWorker_1 = require("../scheduledTasks/inboxWorker");
const activityCleanupTask_1 = require("../scheduledTasks/activityCleanupTask");
const index_1 = __importDefault(require("../api/grammar/index"));
const index_2 = __importDefault(require("../api/demo/index"));
// Import collaboration server
const hocuspocus_server_1 = require("./websockets/hocuspocus-server");
// Import routers
const index_3 = __importDefault(require("../api/auth/index"));
const index_4 = __importDefault(require("../api/survey/index"));
const index_5 = __importDefault(require("../api/originality/index"));
const index_6 = __importDefault(require("../api/citations/index"));
const index_7 = __importDefault(require("../api/annotations/index"));
const index_8 = __importDefault(require("../api/notifications/index"));
const index_9 = __importDefault(require("../api/team-chat/index"));
const index_10 = __importDefault(require("../api/pdf/index"));
const index_11 = __importDefault(require("../api/workspaces/index"));
const index_12 = __importDefault(require("../api/authorship/index"));
const index_13 = __importDefault(require("../api/ai-detection/index"));
const index_14 = __importDefault(require("../api/analytics/index"));
const index_15 = __importDefault(require("../api/subscription/index"));
const lemonsqueezy_1 = __importDefault(require("../api/webhooks/lemonsqueezy"));
const index_16 = __importDefault(require("../api/users/index"));
const documentUpload_1 = __importDefault(require("../api/documents/documentUpload"));
const fileProcessing_1 = __importDefault(require("../api/files/fileProcessing"));
const projects_1 = __importDefault(require("../api/projects/projects"));
const index_17 = __importDefault(require("../api/editor/index"));
const route_1 = __importDefault(require("../api/recyclebin/route"));
const index_18 = __importDefault(require("../api/feedback/index"));
const index_19 = __importDefault(require("../api/support-ticket/index"));
const index_20 = __importDefault(require("../api/feature-request/index"));
const index_21 = __importDefault(require("../api/contact/index"));
const index_22 = __importDefault(require("../api/onboarding/index"));
const index_23 = __importDefault(require("../api/chat/index"));
const index_24 = __importDefault(require("../api/waitlist/index"));
const upload_1 = __importDefault(require("../api/images/upload"));
const index_25 = __importDefault(require("../api/templates/index"));
const index_26 = __importDefault(require("../api/workspace-templates/index"));
const index_27 = __importDefault(require("../api/behavioral-tracking/index"));
const index_28 = __importDefault(require("../api/proxy/index"));
const index_29 = __importDefault(require("../api/sources/index"));
const unsplash_1 = __importDefault(require("../api/integrations/unsplash"));
const index_30 = __importDefault(require("../api/search-alerts/index"));
const index_31 = __importDefault(require("../api/research/index"));
const index_32 = __importDefault(require("../audit/index"));
const subscriptionJobs_1 = require("../jobs/subscriptionJobs");
const searchAlertJobs_1 = require("../jobs/searchAlertJobs");
const index_33 = __importDefault(require("../api/admin/index"));
const observability_1 = __importDefault(require("../api/admin/observability"));
const adminAuth_1 = __importDefault(require("../api/admin/adminAuth"));
const index_34 = __importDefault(require("../api/blogs/index"));
// Publishing Platform (Phase 3): export job system + router
const jobs_1 = require("../publishing/jobs");
const index_35 = __importDefault(require("../api/zotero/index"));
const index_36 = __importDefault(require("../api/mendeley/index"));
const index_37 = __importDefault(require("../api/references/index"));
const collections_1 = __importDefault(require("../api/references/collections"));
const index_38 = __importDefault(require("../api/google-drive/index"));
const index_39 = __importDefault(require("../api/onedrive/index"));
const app = new Proxy({}, { get: () => (..._a) => ({}) });
/** Clean up stale temp files from previous runs (files older than 1 hour) */
function cleanupStaleTempFiles() {
    const uploadsDir = path_1.default.join(__dirname, "../uploads");
    if (!fs_1.default.existsSync(uploadsDir))
        return;
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour
    try {
        const files = fs_1.default.readdirSync(uploadsDir);
        let cleaned = 0;
        for (const file of files) {
            const filePath = path_1.default.join(uploadsDir, file);
            try {
                const stat = fs_1.default.statSync(filePath);
                if (now - stat.mtimeMs > maxAge) {
                    fs_1.default.unlinkSync(filePath);
                    cleaned++;
                }
            }
            catch { /* skip files we can't stat/unlink */ }
        }
        if (cleaned > 0) {
            console.log(`[Startup] Cleaned up ${cleaned} stale temp files from uploads/`);
        }
    }
    catch { /* best-effort cleanup */ }
}
// Start Scheduled Tasks
(0, checkSearchAlerts_1.scheduleSearchAlertsTask)();
(0, cleanupExpiredItems_1.scheduleCleanupTask)();
(0, versionCleanupTask_1.scheduleVersionCleanupTask)();
(0, versionSchedulingTask_1.scheduleVersionSchedulingTask)();
(0, taskReminderTask_1.scheduleTaskReminderTask)();
(0, inboxWorker_1.scheduleInboxWorkerTask)();
(0, activityCleanupTask_1.scheduleActivityCleanupTask)(); // 7-day retention: purges realTimeActivity + authorshipActivity older than 7 days
// Trust only the Render/Cloudflare proxy chain (not open to all)
app.set("trust proxy", ["loopback", "linklocal", "uniquelocal"]);
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
    "http://localhost:3002",
    "http://localhost:3002/",
    "http://localhost:5173",
    "http://localhost:5173/",
    /\.vercel\.app$/,
];
const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.some((o) => typeof o === "string" ? o === origin : o.test(origin))) {
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
        "x-auth-google",
        "x-auth-microsoft",
    ],
    // Expose custom response headers so the frontend can read web search status.
    exposedHeaders: ["X-Web-Search-Status", "X-Web-Search-Message"],
    maxAge: 86400, // Cache preflight response for 24 hours
};
// Apply CORS middleware globally BEFORE all routes
app.use((0, cors_1.default)(corsOptions));
// Explicitly handle OPTIONS preflight for all routes
app.options("*", (0, cors_1.default)(corsOptions));
// Security headers (sets X-Content-Type-Options, HSTS, frameguard, etc.)
app.use((0, helmet_1.default)());
// Webhooks MUST be registered BEFORE global express.json to get raw body
// Important for signature verification (LemonSqueezy, etc.)
app.use("/api/webhooks", lemonsqueezy_1.default);
app.use(express_1.default.json({
    limit: "50mb",
    verify: (req, res, buf) => {
        req.rawBody = buf;
    },
}));
// Apply Global API Rate Limiter
// Stops generic abuse/scraping
app.use(rateLimiter_1.apiLimiter);
// Debug middleware
// Request Instrumentation Middleware
app.use((req, res, next) => {
    // Attach start time to request
    req.startTime = Date.now();
    req.authTime = 0; // Will be populated by auth middleware
    // Log request start
    console.log(`[ENTRY] ${req.method} ${req.url}`);
    // Log response time on finish
    res.on("finish", () => {
        const duration = Date.now() - req.startTime;
        const authTime = req.authTime || 0;
        const dbTime = req.dbTime || 0; // Placeholder if we implement ALS later
        const processingTime = duration - authTime - dbTime;
        const logLevel = duration > 500 ? "warn" : "info";
        // Structured performance log
        logger_1.default.log(logLevel, "Request Performance", {
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
            console.log(`[PERF][SLOW] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms (Auth: ${authTime}ms)`);
        }
        else {
            console.log(`[PERF] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms (Auth: ${authTime}ms)`);
        }
    });
    next();
});
// Error handling middleware
app.use(async (err, req, res, next) => {
    logger_1.default.error("Unhandled error", {
        error: err.stack,
        url: req.url,
        method: req.method,
    });
    res.status(500).json({
        success: false,
        message: "Something went wrong!",
        error: (await secrets_service_1.SecretsService.getNodeEnv()) === "development"
            ? err.message
            : undefined,
    });
});
// Health check endpoint
// Health check endpoint
app.get("/health", async (req, res) => {
    try {
        // Timeout promise (200ms) to ensure strict response time
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("DB_TIMEOUT")), 200));
        // Database check promise
        const dbCheck = async () => {
            // If we are still initializing, this might block, hence the timeout wrapper
            const prisma = await (0, prisma_async_1.initializePrisma)();
            await prisma.$queryRaw `SELECT 1`;
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
    }
    catch (error) {
        const isTimeout = error.message === "DB_TIMEOUT";
        const status = isTimeout ? "WARN" : "DEGRADED";
        // Only log actual errors, not timeouts (to avoid spam if DB is slow but working)
        if (!isTimeout) {
            logger_1.default.error("Health check - DB Connection Failed", {
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
    exec("libreoffice --version", (err, stdout, stderr) => {
        if (err) {
            return res.status(500).json({ err: err.message, stderr });
        }
        res.json({ stdout, stderr });
    });
});
// Mount routers with authentication
const authMiddleware = auth_1.authenticateExpressRequest;
// Auth API (No authentication required for login/register)
app.use("/api/auth", rateLimiter_1.authLimiter, index_3.default);
// Public Demo API (No authentication required)
app.use("/api/demo", index_2.default);
// AI Grammar Checker API
app.use("/api/grammar", authMiddleware, index_1.default);
// Survey API (Authentication required)
app.use("/api/survey", authMiddleware, index_4.default);
app.use("/api/workspaces", index_11.default);
app.use("/api/team-chat", index_9.default);
app.use("/api/notifications", index_8.default);
app.use("/api/pdf", index_10.default);
// Originality Map API (MVP Feature #1)
app.use("/api/originality", authMiddleware, index_5.default);
// Citations API (MVP Feature #2 - Citation Confidence + Missing Link)
app.use("/api/citations", authMiddleware, index_6.default);
// Annotations API (Feature 2: PDF Annotator)
app.use("/api/annotations", authMiddleware, index_7.default);
// Authorship Certificate API (MVP Feature #4)
app.use("/api/authorship", authMiddleware, index_12.default);
// AI Detection API
app.use("/api/ai-detection", authMiddleware, index_13.default);
// Comprehensive Citation Audit Engine API
app.use("/api/audit", authMiddleware, index_32.default);
// Apply auth middleware to notification routes
app.use("/api/notifications", authMiddleware);
// Mount the notifications router
app.use("/api/notifications", index_8.default);
// Analytics API
app.use("/api/analytics", authMiddleware, index_14.default);
// Admin Platform API.
// NOTE: No global authMiddleware here — admin routers authenticate internally
// via `isPlatformAdmin`, which accepts either a dedicated Admin JWT
// (/api/admin/auth/login) or a Supabase token whose email matches an
// `admin_users` row. The dedicated admin auth router is mounted separately
// below (login/bootstrap must be reachable without an admin session).
// Observability must mount before /api/admin because Express matches by prefix.
app.use("/api/admin/auth", adminAuth_1.default);
app.use("/api/admin/observability", rateLimiter_1.adminOperationRateLimiter, observability_1.default);
app.use("/api/admin", rateLimiter_1.adminOperationRateLimiter, index_33.default);
// Subscription API
app.use("/api/subscription", index_15.default);
// Document Upload API (MVP Core Feature)
app.use("/api/documents", authMiddleware, rateLimiter_1.uploadLimiter, documentUpload_1.default);
// File Processing API (Import/Export)
app.use("/api/files", authMiddleware, fileProcessing_1.default);
// Images API (Upload to Supabase)
app.use("/api/images", authMiddleware, rateLimiter_1.uploadLimiter, upload_1.default);
// Behavioral Tracking API
app.use("/api/behavioral-tracking", authMiddleware, index_27.default);
// Users API (Authentication required)
app.use("/api/users", authMiddleware, index_16.default);
// Webhooks moved to before global express.json middleware
// Moved to line ~88 to support raw body parsing
// app.use("/api/webhooks", webhookRouter);
app.use("/api/projects", authMiddleware, projects_1.default);
app.use("/api/editor", authMiddleware, index_17.default);
// Feedback API (Authentication required for most routes, public endpoint available)
app.use("/api/feedback", index_18.default);
// Support Ticket API (Authentication required)
app.use("/api/support-ticket", authMiddleware, index_19.default);
// Feature Request API (Some endpoints public, others require authentication)
app.use("/api/feature-request", index_20.default);
// Contact API (Public)
app.use("/api/contact", index_21.default);
// Waitlist API (Public)
app.use("/api/waitlist", index_24.default);
// Public Blog API (No auth required - serves published posts to the website)
app.use("/api/blogs", index_34.default);
// Recycle Bin API (Authentication required)
app.use("/api/recyclebin", authMiddleware, route_1.default);
// Onboarding API (Authentication required)
app.use("/api/onboarding", authMiddleware, index_22.default);
// AI Chat API (Authentication required)
app.use("/api/chat", authMiddleware, index_23.default);
// Templates API (Authentication required)
app.use("/api/templates", authMiddleware, index_25.default);
// Workspace Templates API (Authentication required)
app.use("/api/workspace-templates", authMiddleware, index_26.default);
// Proxy API (Authentication required)
app.use("/api/proxy", authMiddleware, index_28.default);
// Sources API (Authentication required - Source Integration Verification)
app.use("/api/sources", authMiddleware, index_29.default);
// Integrations API (Unsplash Proxy)
app.use("/api/integrations/unsplash", authMiddleware, unsplash_1.default);
// Search Alerts API
app.use("/api/search-alerts", authMiddleware, index_30.default);
// Research Assistant API
app.use("/api/research", authMiddleware, index_31.default);
// Apply auth middleware to notification routes
app.use("/api/notifications", authMiddleware);
app.use("/api/zotero", index_35.default);
app.use("/api/mendeley", index_36.default);
app.use("/api/references", index_37.default);
app.use("/api/references/collections", collections_1.default);
// Cloud routes have their own authenticateHybridRequest middleware per-route
app.use("/api/google-drive", index_38.default);
app.use("/api/onedrive", index_39.default);
// Publishing Platform (Phase 3) — export job API. The router applies its own
// authentication; the worker is started once the DB is ready (see startServer).
exports.exportJobSystem = (0, jobs_1.createExportJobSystem)();
app.use("/api/publishing", (0, jobs_1.createPublishingRouter)(exports.exportJobSystem.service, {
    cdmResolver: exports.exportJobSystem.resolver,
    templateResolver: exports.exportJobSystem.templateResolver,
}));
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
    // Clean up stale temp files from previous runs
    cleanupStaleTempFiles();
    // Schedule the cleanup task for expired recycle bin items
    (0, cleanupExpiredItems_1.scheduleCleanupTask)();
    // Schedule the version cleanup task based on subscription plans
    (0, versionCleanupTask_1.scheduleVersionCleanupTask)(); // Added import and function call
    try {
        console.log("🚀 Starting server initialization...");
        const PORT = Number(process.env.PORT) || 3001;
        // PRIORITY 1: Bind port immediately for Render
        const server = app.listen(PORT, "0.0.0.0", () => {
            logger_1.default.info(`Server running on port ${PORT}`);
            console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
        });
        // Increase max HTTP header size to 64KB (default is 16KB)
        // Prevents 431 errors when auth tokens/cookies are large
        server.maxHeadersCount = 100;
        server.maxHeaderSize = 64 * 1024;
        // PRIORITY 2: Initialize Database and Services in background
        // This prevents startup timeouts if DB connection is slow
        const initServices = async () => {
            try {
                // Initialize database connection
                logger_1.default.info("Initializing database connection...");
                await (0, prisma_async_1.initializePrisma)();
                logger_1.default.info("✅ Database initialized successfully");
                // Initialize scheduled jobs
                recycleBinService_1.RecycleBinService.scheduleCleanup();
                (0, subscriptionJobs_1.initializeSubscriptionJobs)();
                (0, searchAlertJobs_1.initializeSearchAlertJobs)();
                logger_1.default.info("✅ Scheduled jobs initialized");
                // Publishing Platform (Phase 3): start the async export worker pool.
                // Only runs in processes that have booted with a DB; safe to call once.
                exports.exportJobSystem.worker.start();
                logger_1.default.info("✅ Export job worker started");
            }
            catch (initError) {
                logger_1.default.error("❌ Failed to initialize services:", initError);
                console.error("❌ Critical Service Failure:", initError);
                // Optional: close server if DB is strictly required for health check to pass
                // or keep it running to serve 503s
            }
        };
        // Trigger background initialization
        initServices();
        // Initialize the task scheduler for leaderboard updates
        try {
            const scheduler = await import("../tasks/scheduler.js");
            logger_1.default.info("Task scheduler initialized successfully");
        }
        catch (error) {
            logger_1.default.error("Failed to initialize task scheduler:", error);
        }
        // Initialize the version scheduler
        try {
            const versionScheduler = await import("../services/versionSchedulerService.js");
            versionScheduler.default.start();
            logger_1.default.info("Version scheduler initialized successfully");
        }
        catch (error) {
            logger_1.default.error("Failed to initialize version scheduler:", error);
        }
        // Initialize notification WebSocket server (No port - multiplexed)
        let notificationServerInstance;
        try {
            const { NotificationServer } = await import("./websockets/notification-server.js");
            notificationServerInstance = new NotificationServer(8082); // Keep port for service reference if needed
            logger_1.default.info("Notification WebSocket server initialized (multiplexed)");
        }
        catch (error) {
            logger_1.default.error("Failed to initialize notification WebSocket server:", error);
        }
        // Initialize collaboration WebSocket server (Hocuspocus) (No port - multiplexed)
        let collaborationServerInstance;
        try {
            collaborationServerInstance = new hocuspocus_server_1.HocuspocusCollaborationServer();
            // In multiplexed mode, we don't call .start() as it would try to listen on a port
            logger_1.default.info("WebSocket collaboration server initialized (multiplexed)");
        }
        catch (error) {
            logger_1.default.error("Failed to initialize WebSocket collaboration server:", error);
        }
        // Set up WebSocket multiplexing
        server.on("upgrade", (request, socket, head) => {
            const pathname = request.url ? url.parse(request.url).pathname : "";
            console.log(`[HP-DIAG] Upgrade requested for pathname: ${pathname}`);
            if (pathname === "/collaboration" && collaborationServerInstance) {
                logger_1.default.info("[HP-DIAG][MainServer] Routing to collaboration server");
                collaborationServerInstance.handleUpgrade(request, socket, head);
            }
            else if (pathname === "/notifications" && notificationServerInstance) {
                logger_1.default.info("[HP-DIAG][MainServer] Routing to notification server");
                notificationServerInstance.handleUpgrade(request, socket, head);
            }
            else {
                logger_1.default.warn(`[HP-DIAG][MainServer] No handler for upgrade request: ${pathname}`);
                socket.destroy();
            }
        });
    }
    catch (error) {
        console.error("❌ Failed to start server:", error);
        logger_1.default.error("❌ Failed to start server:", error);
        process.exit(1);
    }
};
// startServer(); // disabled for probe
const googleAnalyticsService_1 = require("../services/admin/integrations/googleAnalyticsService");
async function probe() {
    console.log("FRESH PID", process.pid);
    try {
        const rows = await googleAnalyticsService_1.gaService.getEvents();
        console.log("ROWS:", rows.rows?.length, rows.rows?.map((r) => r.dimensionValues[0].value));
    }
    catch (e) {
        console.log("FRESH FAILED:", e.message);
    }
    process.exit(0);
}
probe();
exports.default = app;
// Server Entry Point - Triggering Restart... 06/14 // LAST UPDATE: 2026-06-14 09:20:00
