import { initializePrisma } from "../src/lib/prisma-async";
import * as dotenv from "dotenv";

dotenv.config();

async function checkSecretD() {
  const prisma = await initializePrisma();
  console.log("--- Checking Secret 'D' ---");
  try {
    const result = await prisma.$queryRawUnsafe(
      "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'D' LIMIT 1"
    ) as any[];
    if (result.length > 0) {
      console.log("Secret 'D' content:", result[0].decrypted_secret);
    } else {
      console.log("Secret 'D' not found.");
    }
  } catch (err) {
    console.error("Error querying vault:", err);
  }
  process.exit(0);
}

checkSecretD().catch(console.error);
