// Script to inspect Supabase Vault content
// Usage: npx ts-node -r tsconfig-paths/register scripts/debug-vault.ts

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("🔍 Debugging Supabase Vault...");

  // Import Prisma dynamically
  console.log("Loading Prisma client...");
  let prisma;
  try {
    const prismaModule = await import("../src/lib/prisma");
    prisma = prismaModule.default || prismaModule.prisma;
    console.log("✅ Prisma client loaded");
  } catch (err: any) {
    console.error("❌ Failed to load app prisma client:", err.message);
    process.exit(1);
  }

  try {
    // 1. Check vault.secrets (Raw Table)
    console.log("\n--- vault.secrets (Raw Table) ---");
    const secrets = (await prisma.$queryRawUnsafe(
      `SELECT id, name, created_at FROM vault.secrets`
    )) as any[];
    console.log(`Found ${secrets.length} secrets in vault.secrets`);

    // 2. Check vault.decrypted_secrets (View)
    console.log("\n--- vault.decrypted_secrets (View) ---");
    const decrypted = (await prisma.$queryRawUnsafe(
      `SELECT name, decrypted_secret FROM vault.decrypted_secrets`
    )) as any[];
    console.log(`Found ${decrypted.length} decrypted secrets`);

    // 3. Test specific key: NEXT_PUBLIC_SUPABASE_URL
    const testKey = "NEXT_PUBLIC_SUPABASE_URL";
    console.log(`\n--- Testing Exact Query for: '${testKey}' ---`);
    const specific = (await prisma.$queryRawUnsafe(
      `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1`,
      testKey
    )) as any[];

    // Write results to file
    const match = specific.length > 0 ? "FOUND" : "MISSING";
    const report = `
TIMESTAMP: ${new Date().toISOString()}
SECRETS_COUNT: ${secrets.length}
DECRYPTED_COUNT: ${decrypted.length}
TEST_KEY: ${testKey}
RESULT: ${match}
FIRST_SECRET_NAME: ${decrypted.length > 0 ? decrypted[0].name : "NONE"}
VAL_PREVIEW: ${specific.length > 0 && specific[0].decrypted_secret ? specific[0].decrypted_secret.substring(0, 5) : "N/A"}
FULL_DUMP_NAMES: ${JSON.stringify(decrypted.map((s) => s.name))}
    `;
    fs.writeFileSync("vault-debug.log", report);
    console.log("Written to vault-debug.log");
  } catch (error: any) {
    console.error("❌ Error querying vault:", error);
    fs.writeFileSync("vault-debug.log", "ERROR: " + error.message);
  } finally {
    if (prisma) await prisma.$disconnect();
    process.exit(0);
  }
}

main();
