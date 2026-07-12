/**
 * Migration script: Encrypt existing plaintext OAuth tokens in the database.
 *
 * Run once after deploying the token encryption changes:
 *   cd backend && npx ts-node scripts/migrate-encrypt-tokens.ts
 *
 * What it does:
 * 1. Finds all users with non-null google_access_token that are NOT already encrypted
 * 2. Encrypts them using TokenCrypto.encrypt()
 * 3. Same for google_refresh_token, onedrive_access_token, onedrive_refresh_token
 * 4. Skips already-encrypted tokens (detected via TokenCrypto.isEncrypted())
 */

import { PrismaClient } from "@prisma/client";
import { TokenCrypto } from "../src/services/crypto/tokenCrypto";

const prisma = new PrismaClient();

async function main() {
  console.log("[Migration] Starting OAuth token encryption migration...");

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { google_access_token: { not: null } },
        { google_refresh_token: { not: null } },
        { onedrive_access_token: { not: null } },
        { onedrive_refresh_token: { not: null } },
      ],
    },
    select: {
      id: true,
      google_access_token: true,
      google_refresh_token: true,
      onedrive_access_token: true,
      onedrive_refresh_token: true,
    },
  });

  console.log(`[Migration] Found ${users.length} users with OAuth tokens.`);

  let encrypted = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of users) {
    const data: Record<string, string | null> = {};
    let needsUpdate = false;

    // Google access token
    if (user.google_access_token && !TokenCrypto.isEncrypted(user.google_access_token)) {
      try {
        data.google_access_token = TokenCrypto.encrypt(user.google_access_token);
        needsUpdate = true;
      } catch (e: any) {
        console.error(`[Migration] Failed to encrypt google_access_token for ${user.id}: ${e.message}`);
        errors++;
      }
    }

    // Google refresh token
    if (user.google_refresh_token && !TokenCrypto.isEncrypted(user.google_refresh_token)) {
      try {
        data.google_refresh_token = TokenCrypto.encrypt(user.google_refresh_token);
        needsUpdate = true;
      } catch (e: any) {
        console.error(`[Migration] Failed to encrypt google_refresh_token for ${user.id}: ${e.message}`);
        errors++;
      }
    }

    // OneDrive access token
    if (user.onedrive_access_token && !TokenCrypto.isEncrypted(user.onedrive_access_token)) {
      try {
        data.onedrive_access_token = TokenCrypto.encrypt(user.onedrive_access_token);
        needsUpdate = true;
      } catch (e: any) {
        console.error(`[Migration] Failed to encrypt onedrive_access_token for ${user.id}: ${e.message}`);
        errors++;
      }
    }

    // OneDrive refresh token
    if (user.onedrive_refresh_token && !TokenCrypto.isEncrypted(user.onedrive_refresh_token)) {
      try {
        data.onedrive_refresh_token = TokenCrypto.encrypt(user.onedrive_refresh_token);
        needsUpdate = true;
      } catch (e: any) {
        console.error(`[Migration] Failed to encrypt onedrive_refresh_token for ${user.id}: ${e.message}`);
        errors++;
      }
    }

    if (needsUpdate) {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data,
        });
        encrypted++;
        console.log(`[Migration] Encrypted tokens for user ${user.id}`);
      } catch (e: any) {
        console.error(`[Migration] Failed to update user ${user.id}: ${e.message}`);
        errors++;
      }
    } else {
      skipped++;
    }
  }

  console.log(`\n[Migration] Complete!`);
  console.log(`  Encrypted: ${encrypted} users`);
  console.log(`  Skipped (already encrypted): ${skipped} users`);
  console.log(`  Errors: ${errors}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("[Migration] Fatal error:", e);
  process.exit(1);
});
