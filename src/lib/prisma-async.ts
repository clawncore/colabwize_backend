import { PrismaClient } from "@prisma/client";
import logger from "../monitoring/logger";
import { SecretsService } from "../services/secrets-service";

const globalForPrisma = global as unknown as {
    prisma: PrismaClient | undefined;
};

// Async function to initialize Prisma with proper database URL
export async function initializePrisma(): Promise<PrismaClient> {
    if (globalForPrisma.prisma) {
        return globalForPrisma.prisma;
    }

    // Get database URL from secrets service
    let databaseUrl = await SecretsService.getDatabaseUrl();

    console.log(
        "DEBUG: Initializing Prisma with connection string present:",
        !!databaseUrl
    );

    if (!databaseUrl) {
        logger.error("❌ DATABASE_URL not found in environment or secrets");
        throw new Error("DATABASE_URL is required for database connection");
    }

    // Enforce strict SSL for Node 22+ compatibility with Supabase
    // This fixes P1011 OpenSSL error
    if (!databaseUrl.includes("sslaccept=strict")) {
        const separator = databaseUrl.includes("?") ? "&" : "?";
        databaseUrl += `${separator}sslaccept=strict`;
        console.log("🔒 Enforced strict SSL (sslaccept=strict) for database connection");
    }

    // Log the redacted URL for debugging
    const redactedUrl = databaseUrl.replace(/:([^:@]+)@/, ":****@");
    console.log(`DEBUG: Final Connection String: ${redactedUrl}`);

    // Set the DATABASE_URL environment variable for Prisma
    process.env.DATABASE_URL = databaseUrl;

    // Initialize Prisma Client
    const prisma = new PrismaClient({
        log:
            process.env.NODE_ENV === "development"
                ? ["query", "error", "warn"]
                : ["error"],
        errorFormat: "pretty",
    });

    // Test database connection
    try {
        logger.info("Attempting database connection...");
        await prisma.$connect();
        logger.info("✅ Database connection established");
    } catch (error: any) {
        logger.error("❌ Failed to connect to database:", error);
        throw error;
    }

    // Store in global for reuse
    if (process.env.NODE_ENV !== "production") {
        globalForPrisma.prisma = prisma;
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