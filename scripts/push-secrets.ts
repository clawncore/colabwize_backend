// Script to push secrets from .env to Supabase Secrets
// Usage: npx ts-node -r tsconfig-paths/register scripts/push-secrets.ts

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { exec } from "child_process";
import { promisify } from "util";

// Load environment variables FIRST
dotenv.config();

const execAsync = promisify(exec);

async function pushSecrets() {
  const envPath = path.resolve(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    console.error("❌ .env file not found at", envPath);
    process.exit(1);
  }

  // Import Prisma from the app's lib (uses pg adapter, etc.)
  // We use dynamic import to ensure dotenv works first
  // We point to src/lib/prisma.ts relative to scripts/
  console.log("Loading Prisma client...");
  let prisma;
  try {
    // Attempt to resolve path knowing we are in backend root usually
    const prismaModule = await import("../src/lib/prisma");
    prisma = prismaModule.default || prismaModule.prisma;
    console.log("✅ Prisma client loaded from app");
  } catch (err: any) {
    console.error("❌ Failed to load app prisma client:", err.message);
    console.error(
      "Make sure to run with: npx -y ts-node -r tsconfig-paths/register scripts/push-secrets.ts"
    );
    process.exit(1);
  }

  // Parse .env manually to iterate
  const envConfig = dotenv.parse(fs.readFileSync(envPath));

  console.log(`Found ${Object.keys(envConfig).length} variables in .env`);

  const SKIP_KEYS = [
    "PORT",
    "NODE_ENV",
    "DIRECT_URL",
    "DATABASE_URL", // Already in prisma
  ];

  try {
    for (const [key, value] of Object.entries(envConfig)) {
      if (SKIP_KEYS.includes(key)) {
        console.log(`⏭️  Skipping ${key}`);
        continue;
      }

      if (!value) {
        console.log(`⚠️  Skipping ${key} (Empty)`);
        continue;
      }

      try {
        console.log(`Processing ${key}...`);
        const escapedValue = value.replace(/"/g, '\\"');

        // 1. Set in Supabase Edge Functions (CLI)
        try {
          await execAsync(`supabase secrets set ${key}="${escapedValue}"`);
          console.log(`  ✅ CLI: Set Edge Function secret`);
        } catch (cliError: any) {
          // console.warn(`  ⚠️ CLI Warning: ${cliError.message}`);
        }

        // 2. Set in Supabase Vault (Database)
        try {
          const sqlValue = escapedValue.replace(/'/g, "''");

          await prisma.$executeRawUnsafe(
            `DELETE FROM vault.secrets WHERE name = $1`,
            key
          );

          // Note: vault.create_secret requires 'pgcrypto' usually, but 'vault' extension handles it?
          // create_secret(secret, name, description, key_id, nonce)
          // If we just pass 2 args, it might work if defaults are set.
          // Documentation says: create_secret(secret text, name text ...)

          await prisma.$executeRawUnsafe(
            `SELECT vault.create_secret($1, $2)`,
            value,
            key
          );

          console.log(`  ✅ DB: Set Vault secret`);
        } catch (dbError: any) {
          console.warn(`  ⚠️ DB Warning: ${dbError.message}`);
        }
      } catch (error: any) {
        console.error(`❌ Failed to set ${key}:`, error.message);
      }
    }
  } finally {
    // Clean up
    if (prisma) await prisma.$disconnect();
    // Force exit because pool might keep it open
    process.exit(0);
  }
}

pushSecrets();
