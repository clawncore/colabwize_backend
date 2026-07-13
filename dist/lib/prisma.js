"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const logger_1 = __importDefault(require("../monitoring/logger"));
const globalForPrisma = global;
const configureDatabaseUrl = () => {
    let connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        logger_1.default.error("❌ DATABASE_URL environment variable is missing");
        return;
    }
    try {
        // Force IPv4
        try {
            const dns = require('dns');
            if (dns.setDefaultResultOrder) {
                dns.setDefaultResultOrder('ipv4first');
            }
        }
        catch (e) { /* ignore */ }
        // Log connection details (sanitized)
        const url = new URL(connectionString);
        // [AUDIT] Enforce Transaction Pooler (Port 6543) for Render
        if (url.port === "5432") {
            const isRender = process.env.RENDER || process.env.IS_RENDER;
            if (isRender) {
                logger_1.default.warn("⚠️ [PERFORMANCE] USING SESSION POOLING (PORT 5432) ON RENDER. Recommend switching to Port 6543.");
            }
        }
        // Ensure pgbouncer param is present for Pooler (Port 6543)
        // Transaction Mode requires pgbouncer=true to maintain prepared statement compatibility or disable them
        if (url.port === "6543" && !url.searchParams.has("pgbouncer")) {
            url.searchParams.set("pgbouncer", "true");
        }
        logger_1.default.info("Database Connection Details:", {
            host: url.hostname,
            port: url.port,
            database: url.pathname,
            params: Object.fromEntries(url.searchParams),
            poolerMode: url.port === "6543" ? "Transaction" : "Session"
        });
        // Set connection pool settings
        if (!url.searchParams.has("connection_limit")) {
            // Increased for concurrent PDF generation load
            url.searchParams.set("connection_limit", "20");
        }
        if (!url.searchParams.has("pool_timeout")) {
            url.searchParams.set("pool_timeout", "60");
        }
        // Add connect_timeout to handle cross-region latency
        if (!url.searchParams.has("connect_timeout")) {
            url.searchParams.set("connect_timeout", "30");
        }
        // Update the environment variable with modified URL
        process.env.DATABASE_URL = url.toString();
    }
    catch (error) {
        logger_1.default.error("❌ Error parsing DATABASE_URL:", error);
    }
};
// Configure database URL before creating PrismaClient
configureDatabaseUrl();
// Prisma client configuration - Prisma 7.x uses prisma.config.ts for connection URLs
// Create PostgreSQL connection pool for Prisma 7 driver adapter
const connectionString = process.env.DATABASE_URL;
let adapter;
if (connectionString) {
    adapter = new adapter_pg_1.PrismaPg({ connectionString });
}
exports.prisma = globalForPrisma.prisma ||
    new client_1.PrismaClient({
        log: process.env.NODE_ENV === "development"
            ? ["query", "error", "warn"]
            : ["error"],
        errorFormat: "pretty",
        ...(adapter ? { adapter } : {}),
    });
// [AUDIT] Removed eager connection block. 
// Prisma connects lazily on the first query.
// @ts-ignore - TypeScript has issues with extended client type assignment
// @ts-ignore - TypeScript has issues with extended client type assignment
globalForPrisma.prisma = exports.prisma;
// Add graceful shutdown handler
// [AUDIT] Removed process.on("beforeExit") handler to prevent infinite loop.
// "beforeExit" triggers when event loop is empty. Scheduling async work ($disconnect)
// keeps the process alive, emptying the loop again, and re-triggering "beforeExit".
process.on("SIGINT", async () => {
    logger_1.default.info("Closing database connections (SIGINT)...");
    await exports.prisma.$disconnect();
    process.exit(0);
});
process.on("SIGTERM", async () => {
    logger_1.default.info("Closing database connections (SIGTERM)...");
    await exports.prisma.$disconnect();
    process.exit(0);
});
exports.default = exports.prisma;
