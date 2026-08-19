-- AlterTable
ALTER TABLE "support_messages" ADD COLUMN "priority" TEXT DEFAULT 'medium';
ALTER TABLE "support_messages" ADD COLUMN "is_read" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "support_messages" ADD COLUMN "folder" TEXT DEFAULT 'Support';
