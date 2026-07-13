import { initializePrisma } from "../src/lib/prisma-async";
import * as dotenv from "dotenv";

dotenv.config();

async function checkSecrets() {
  const prisma = await initializePrisma();
  console.log("--- Checking Supabase Vault Secrets ---");
  try {
    const results = await prisma.$queryRawUnsafe(
      "SELECT name, decrypted_secret FROM vault.decrypted_secrets WHERE name = 'REACT_APP_UNSPLASH_ACCESS_KEY'"
    ) as any[];
    console.log("Unsplash Secret Value:", results[0]?.decrypted_secret);
  } catch (err) {
    console.error("Error querying vault:", err);
  }
  process.exit(0);
}

checkSecrets().catch(console.error);
