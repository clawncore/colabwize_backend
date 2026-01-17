import { PrismaClient } from "@prisma/client";
import logger from "../monitoring/logger";
import { SecretsService } from "../services/secrets-service";

const globalForPrisma = global as unknown as {
  prisma: any;
};

const getConnectionString = (): string => {
  const connectionString = process.env.DATABASE_URL;
  // Append connection pool settings if not present
  if (connectionString && !connectionString.includes("connection_limit")) {
    const separator = connectionString.includes("?") ? "&" : "?";
    // Increase pool size and timeout for development/production stability
    return `${connectionString}${separator}connection_limit=20&pool_timeout=20`;
  }
  return connectionString || "";
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
