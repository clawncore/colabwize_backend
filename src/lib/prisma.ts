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

    // AUTOMATIC FALLBACK TO DIRECT CONNECTION
    const dbUser = url.username || "";
    if (url.port === "6543" && dbUser.includes(".")) {
      const projectRef = dbUser.split(".")[1];
      const directHost = `db.${projectRef}.supabase.co`;
      logger.info(`🔄 [Sync] Switching from Pooler to Direct (${directHost}:5432)`);

      url.hostname = directHost;
      url.port = "5432";
      url.searchParams.delete("pgbouncer");
    }

    logger.info("Database Connection Details:", {
      host: url.hostname,
      port: url.port,
      database: url.pathname,
      params: Object.fromEntries(url.searchParams),
      isSupabasePooler: url.port === "6543"
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

// Test database connection on initialization
if (!globalForPrisma.prisma) {
  // Add retry mechanism for database connection
  const connectWithRetry = async (maxRetries = 5, delay = 5000) => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        logger.info(
          `Attempting database connection (attempt ${i + 1}/${maxRetries})`
        );
        await prisma.$connect();
        logger.info("✅ Database connection established");
        return;
      } catch (error: any) {
        logger.warn(`❌ Database connection attempt ${i + 1} failed`, {
          error,
        });
        if (i < maxRetries - 1) {
          logger.info(`Retrying in ${delay / 1000} seconds...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          logger.error("❌ Failed to connect to database after all retries", {
            error,
          });
          // Don't throw here - let the app start and fail on first query if needed
        }
      }
    }
  };

  logger.info("Starting database connection process");
  connectWithRetry();
}

// @ts-ignore - TypeScript has issues with extended client type assignment
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

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
