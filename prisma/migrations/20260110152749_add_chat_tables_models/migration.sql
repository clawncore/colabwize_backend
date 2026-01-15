/*
  Warnings:

  - You are about to drop the column `ai_detection_scans_count` on the `user_metrics` table. All the data in the column will be lost.
  - You are about to drop the `ai_detection_scans` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ai_detection_sentences` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ai_detection_scans" DROP CONSTRAINT "ai_detection_scans_project_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_detection_scans" DROP CONSTRAINT "ai_detection_scans_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_detection_sentences" DROP CONSTRAINT "ai_detection_sentences_scan_id_fkey";

-- AlterTable
ALTER TABLE "user_metrics" DROP COLUMN "ai_detection_scans_count";

-- AlterTable
ALTER TABLE "user_surveys" ADD COLUMN     "heard_about_platform" TEXT,
ADD COLUMN     "main_job" TEXT,
ADD COLUMN     "user_goal" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "first_upload_at" TIMESTAMP(3),
ADD COLUMN     "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onboarding_skipped" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "ai_detection_scans";

-- DropTable
DROP TABLE "ai_detection_sentences";

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "title" TEXT DEFAULT 'New Chat',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "project_id" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_idx" ON "chat_sessions"("user_id");

-- CreateIndex
CREATE INDEX "chat_sessions_project_id_idx" ON "chat_sessions"("project_id");

-- CreateIndex
CREATE INDEX "chat_messages_session_id_idx" ON "chat_messages"("session_id");

-- CreateIndex
CREATE INDEX "chat_messages_project_id_idx" ON "chat_messages"("project_id");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
