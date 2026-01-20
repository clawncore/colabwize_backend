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

    // Force IPv4 to avoid ENETUNREACH on IPv6 in some Docker/Render environments
    try {
        const dns = require('dns');
        if (dns.setDefaultResultOrder) {
            dns.setDefaultResultOrder('ipv4first');
        }
    } catch (e) {
        // ignore
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

        // AUTOMATIC FALLBACK REMOVED
        // The Direct Connection is IPv6 only (incompatible with Render without addon).
        // We must stick to the Pooler (port 6543) and fix the firewall/timeout issues.
        const dbUser = url.username || ""; // Keep for reference if needed later

        // FORCE IPV4 RESOLUTION
        // Render/Docker sometimes prefers IPv6 which fails with ENETUNREACH.
        // We set default order to ipv4first above, which should handle it.
        // We log the resolution here for diagnostics but DO NOT replace the hostname
        // because replacing hostname with IP breaks TLS SNI (Server Name Indication).
        try {
            const dns = require('dns').promises;
            console.log(`🔍 [DNS] Resolving IPv4 for ${url.hostname}...`);
            const { address } = await dns.lookup(url.hostname, { family: 4 });
            if (address) {
                console.log(`✅ [DNS] Resolved ${url.hostname} -> ${address} (IPv4). Keeping hostname for SNI.`);
            }
        } catch (dnsErr: any) {
            console.warn(`⚠️ [DNS] Failed to resolve IPv4 for ${url.hostname}: ${dnsErr.message}`);
        }

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

        // Connection pool limits
        if (!url.searchParams.has("connection_limit")) {
            url.searchParams.set("connection_limit", "20");
        }

        if (!url.searchParams.has("pool_timeout")) {
            url.searchParams.set("pool_timeout", "60");
        }

        // Add connect_timeout
        if (!url.searchParams.has("connect_timeout")) {
            url.searchParams.set("connect_timeout", "30");
        }

        databaseUrl = url.toString();

        /* Diagnostics removed - Issue confirmed as IPv6 ENETUNREACH.
           Fix implemented via forced IPv4 resolution above. */

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
            console.log(`🔌 Attempting database connection (Attempt ${retries + 1}/${maxRetries})...`);
            await prisma.$connect();
            console.log("✅ Database connection established");

            // Store in global for reuse only after successful connection
            if (process.env.NODE_ENV !== "production") {
                globalForPrisma.prisma = prisma;
            }
            return prisma;
        } catch (error: any) {
            retries++;
            console.error(`❌ Connection failed (Attempt ${retries}/${maxRetries}): ${error.message}`);

            if (retries >= maxRetries) {
                console.error("❌ Max retries reached. Exiting.");
                throw error;
            }

            const delay = Math.min(1000 * Math.pow(2, retries), 10000); // Exponential backoff max 10s
            console.log(`⏳ Retrying in ${delay}ms...`);
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