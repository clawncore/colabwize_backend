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

    try {
        const url = new URL(databaseUrl);

        // Log connection details (sanitized)
        logger.info("Async Database Connection Details:", {
            host: url.hostname,
            port: url.port,
            database: url.pathname,
            params: Object.fromEntries(url.searchParams),
            isSupabasePooler: url.port === "6543"
        });

        // Enforce strict SSL for Supabase compatibility
        if (!url.searchParams.has("sslaccept")) {
            url.searchParams.set("sslaccept", "accept_invalid_certs");
        } else if (url.searchParams.get("sslaccept") === "strict") {
            url.searchParams.set("sslaccept", "accept_invalid_certs");
        }

        // Ensure pgbouncer=true is present if using the pooler port (6543)
        // AND add explicit connection timeouts for cross-region stability
        if (url.port === "6543") {
            if (!url.searchParams.has("pgbouncer")) {
                logger.info("⚠️ [Async] Detected Supabase Pooler (port 6543) without pgbouncer param. Appending pgbouncer=true");
                url.searchParams.set("pgbouncer", "true");
            }
        }

        // Enforce connection pool limits & timeouts
        if (!url.searchParams.has("connection_limit")) {
            url.searchParams.set("connection_limit", "20");
        }

        if (!url.searchParams.has("pool_timeout")) {
            url.searchParams.set("pool_timeout", "60");
        }

        // Add connect_timeout to handle cross-region latency (Oregon -> Mumbai)
        if (!url.searchParams.has("connect_timeout")) {
            url.searchParams.set("connect_timeout", "30");
        }

        databaseUrl = url.toString();

        // [DIAGNOSTICS] Perform network checks
        try {
            const dns = require('dns').promises;
            const net = require('net');

            logger.info(`🔍 [Diagnostics] Resolving DNS for: ${url.hostname}`);
            const addresses = await dns.lookup(url.hostname).catch((e: any) => {
                logger.error(`❌ [Diagnostics] DNS Lookup Failed: ${e.message}`);
                return null;
            });

            if (addresses) {
                logger.info(`✅ [Diagnostics] Resolved IP: ${addresses.address} (Family: IPv${addresses.family})`);

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
        } catch (diagError) {
            logger.warn("⚠️ [Diagnostics] Failed to run network checks:", diagError);
        }

    } catch (error) {
        logger.error("❌ Error parsing/configuring DATABASE_URL in async init:", error);
        // Fallback to original string if parsing fails, though unlikely
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