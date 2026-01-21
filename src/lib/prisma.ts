import { PrismaClient } from "@prisma/client";
import logger from "../monitoring/logger";
import { SecretsService } from "../services/secrets-service";

const globalForPrisma = global as unknown as {
  prisma: any;
};

const getConnectionString = (): string => {
  let connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    logger.error("❌ DATABASE_URL environment variable is missing");
    return "";
  }

  try {
    // Force IPv4
    try {
      const dns = require('dns');
      if (dns.setDefaultResultOrder) {
        dns.setDefaultResultOrder('ipv4first');
      }
    } catch (e) { /* ignore */ }

    // Log connection details (sanitized)
    const url = new URL(connectionString);

    // [AUDIT] Enforce Transaction Pooler (Port 6543) for Render
    if (url.port === "5432") {
      const isRender = process.env.RENDER || process.env.IS_RENDER;
      if (isRender) {
        logger.warn("⚠️ [PERFORMANCE] USING SESSION POOLING (PORT 5432) ON RENDER. Recommend switching to Port 6543.");
      }
    }

    // Ensure pgbouncer param is present for Pooler (Port 6543)
    // Transaction Mode requires pgbouncer=true to maintain prepared statement compatibility or disable them
    if (url.port === "6543" && !url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }

    logger.info("Database Connection Details:", {
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

    // Ensure schema is set if using search_path in other places, though mostly handled by prisma schema

    return url.toString();
  } catch (error) {
    logger.error("❌ Error parsing DATABASE_URL:", error);
    return connectionString || "";
  }
};

// Prisma client configuration - using direct connection for compatibility
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
    errorFormat: "pretty",
    datasources: {
      db: {
        url: getConnectionString(),
      },
    },
  });

// [AUDIT] Removed eager connection block. 
// Prisma connects lazily on the first query.

// @ts-ignore - TypeScript has issues with extended client type assignment
// @ts-ignore - TypeScript has issues with extended client type assignment
globalForPrisma.prisma = prisma;

// Add graceful shutdown handler
process.on("beforeExit", async () => {
  logger.info("Closing database connections (beforeExit)...");
  await prisma.$disconnect();
});

process.on("SIGINT", async () => {
  logger.info("Closing database connections (SIGINT)...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Closing database connections (SIGTERM)...");
  await prisma.$disconnect();
  process.exit(0);
});

export default prisma;
