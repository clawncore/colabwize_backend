/**
 * One-time script to add the `annotations` column to the `TaskAttachment` table.
 * Run with: npx tsx scripts/add-annotations-column.ts
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("Adding annotations column to TaskAttachment...");
  try {
    await prisma.$executeRaw`
      ALTER TABLE "TaskAttachment"
      ADD COLUMN IF NOT EXISTS "annotations" JSONB DEFAULT '[]'::jsonb;
    `;
    console.log("✅ Column added successfully.");
  } catch (err) {
    console.error("❌ Failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
