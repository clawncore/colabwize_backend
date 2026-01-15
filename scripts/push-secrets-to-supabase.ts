/// <reference types="node" />

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

/**
 * Script to push all environment variables from .env to Supabase Vault
 * Run with: npx ts-node scripts/push-secrets-to-supabase.ts
 */

interface SecretStats {
  total: number;
  success: number;
  failed: number;
  skipped: number;
}

const stats: SecretStats = {
  total: 0,
  success: 0,
  failed: 0,
  skipped: 0,
};

// Secrets to skip (not needed in Supabase or already handled differently)
const SKIP_SECRETS = [
  "PORT", // Supabase manages this
  "NODE_ENV", // Set by deployment environment
  "DIRECT_URL", // Prisma-specific, not needed in Supabase
  "SUPABASE_URL", // Built-in Supabase environment variable
  "SUPABASE_ANON_KEY", // Built-in Supabase environment variable
  "SUPABASE_SERVICE_ROLE_KEY", // Built-in Supabase environment variable
];

function parseEnvFile(filePath: string): Record<string, string> {
  const envContent = readFileSync(filePath, "utf-8");
  const env: Record<string, string> = {};

  envContent.split("\n").forEach((line: string) => {
    // Skip comments and empty lines
    if (line.trim().startsWith("#") || !line.trim()) {
      return;
    }

    // Parse KEY=VALUE format
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();

      // Remove quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      env[key] = value;
    }
  });

  return env;
}

function pushSecretToSupabase(key: string, value: string): boolean {
  try {
    // Escape value for shell
    const escapedValue = value.replace(/"/g, '\\"');

    // Execute supabase secrets set command
    execSync(`supabase secrets set ${key}="${escapedValue}"`, {
      stdio: "pipe",
      encoding: "utf-8",
    });

    return true;
  } catch (error: any) {
    console.error(`   Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log("🚀 Supabase Secrets Migration Tool\n");
  console.log("==================================\n");

  // Check if supabase CLI is available
  try {
    execSync("supabase --version", { stdio: "pipe" });
  } catch (error) {
    console.error("❌ Supabase CLI not found!");
    console.error("Install it with: npm install -g supabase");
    process.exit(1);
  }

  // Read .env file
  const envPath = join(__dirname, "..", ".env");

  if (!existsSync(envPath)) {
    console.error(`❌ .env file not found at: ${envPath}`);
    process.exit(1);
  }

  console.log(`📄 Reading environment variables from: ${envPath}\n`);
  const env = parseEnvFile(envPath);

  // Count total secrets
  stats.total = Object.keys(env).length;
  console.log(`Found ${stats.total} environment variables\n`);

  // Push each secret to Supabase
  for (const [key, value] of Object.entries(env)) {
    // Skip if in skip list
    if (SKIP_SECRETS.includes(key)) {
      console.log(`⏭️  Skipping: ${key} (not needed in Supabase)`);
      stats.skipped++;
      continue;
    }

    // Skip if value is empty
    if (!value) {
      console.log(`⏭️  Skipping: ${key} (empty value)`);
      stats.skipped++;
      continue;
    }

    process.stdout.write(`📤 Pushing: ${key}... `);

    if (pushSecretToSupabase(key, value)) {
      console.log("✅");
      stats.success++;
    } else {
      console.log("❌");
      stats.failed++;
    }
  }

  // Print summary
  console.log("\n==================================");
  console.log("📊 Migration Summary\n");
  console.log(`Total secrets found:    ${stats.total}`);
  console.log(`✅ Successfully pushed: ${stats.success}`);
  console.log(`❌ Failed:             ${stats.failed}`);
  console.log(`⏭️  Skipped:            ${stats.skipped}`);
  console.log("==================================\n");

  if (stats.failed > 0) {
    console.log("⚠️  Some secrets failed to push. Check the errors above.");
    process.exit(1);
  }

  console.log("✨ All secrets pushed successfully!");
  console.log("\n💡 Next steps:");
  console.log("1. Verify secrets with: supabase secrets list");
  console.log("2. Deploy your backend to apply the secrets");
  console.log("3. Test all services to ensure they work correctly\n");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
