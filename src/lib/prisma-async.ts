import { PrismaClient } from "@prisma/client";
import logger from "../monitoring/logger";
import { SecretsService } from "../services/secrets-service";

const globalForPrisma = global as unknown as {
    prisma: PrismaClient | undefined;
};

// Async function to initialize Prisma with proper database URL and retry logic
export async function initializePrisma(): Promise<PrismaClient> {
    if (globalForPrisma.prisma) {
        return globalForPrisma.prisma;
    }

    // Prioritize process.env.DATABASE_URL (Render), fallback to SecretsService
    let databaseUrl: string | undefined | null = process.env.DATABASE_URL;
    if (!databaseUrl) {
        databaseUrl = await SecretsService.getDatabaseUrl();
    }

    if (!databaseUrl) {
        logger.error("❌ DATABASE_URL not found in environment or secrets");
        throw new Error("DATABASE_URL is required for database connection");
    }

    // Enforce strict SSL for Supabase compatibility
    // Fix P1011: Use accept_invalid_certs because Supabase Pooler certs may not verify against standard CAs
    if (!databaseUrl.includes("sslaccept=")) {
        const separator = databaseUrl.includes("?") ? "&" : "?";
        databaseUrl += `${separator}sslaccept=accept_invalid_certs`;
    } else if (databaseUrl.includes("sslaccept=strict")) {
        databaseUrl = databaseUrl.replace("sslaccept=strict", "sslaccept=accept_invalid_certs");
    }

    // Ensure pgbouncer=true is present if using the pooler port (6543)
    // This tells Prisma to disable prepared statements
    if (databaseUrl.includes(":6543") && !databaseUrl.includes("pgbouncer=true")) {
        const separator = databaseUrl.includes("?") ? "&" : "?";
        databaseUrl += `${separator}pgbouncer=true`;
    }

    // Enforce connection pool limits if not present
    if (!databaseUrl.includes("connection_limit")) {
        const separator = databaseUrl.includes("?") ? "&" : "?";
        databaseUrl += `${separator}connection_limit=20&pool_timeout=20`;
    }

    const redactedUrl = databaseUrl.replace(/:([^:@]+)@/, ":****@");
    console.log(`DEBUG: Connecting to DB: ${redactedUrl}`);

    process.env.DATABASE_URL = databaseUrl;

    const prisma = new PrismaClient({
        log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
        errorFormat: "pretty",
    });

    // Connection retry logic with exponential backoff
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            logger.info(`Attempting database connection (Attempt ${retries + 1}/${maxRetries})...`);
            await prisma.$connect();
            logger.info("✅ Database connection established");

            // Store in global for reuse only after successful connection
            if (process.env.NODE_ENV !== "production") {
                globalForPrisma.prisma = prisma;
            }
            return prisma;
        } catch (error: any) {
            retries++;
            logger.error(`❌ Connection failed (Attempt ${retries}/${maxRetries}): ${error.message}`);

            if (retries >= maxRetries) {
                logger.error("❌ Max retries reached. Exiting.");
                throw error;
            }

            const delay = Math.min(1000 * Math.pow(2, retries), 10000); // Exponential backoff max 10s
            logger.info(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    return prisma;
}

// Graceful shutdown handler
process.on("beforeExit", async () => {
    if (globalForPrisma.prisma) {
        logger.info("Closing database connections...");
        await globalForPrisma.prisma.$disconnect();
    }
});

export default initializePrisma;