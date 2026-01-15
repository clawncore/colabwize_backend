/*
  Warnings:

  - You are about to drop the `ai_chat_messages` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ai_chat_sessions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `document_versions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ai_chat_messages" DROP CONSTRAINT "ai_chat_messages_session_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_chat_messages" DROP CONSTRAINT "ai_chat_messages_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_chat_sessions" DROP CONSTRAINT "ai_chat_sessions_project_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_chat_sessions" DROP CONSTRAINT "ai_chat_sessions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_project_id_fkey";

-- DropForeignKey
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_user_id_fkey";

-- DropTable
DROP TABLE "ai_chat_messages";

-- DropTable
DROP TABLE "ai_chat_sessions";

-- DropTable
DROP TABLE "document_versions";

-- CreateTable
CREATE TABLE "authorship_activities" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "time_spent" INTEGER NOT NULL,
    "edit_count" INTEGER NOT NULL DEFAULT 0,
    "keystrokes" INTEGER NOT NULL DEFAULT 0,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "session_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorship_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "authorship_activities_project_id_idx" ON "authorship_activities"("project_id");

-- CreateIndex
CREATE INDEX "authorship_activities_user_id_idx" ON "authorship_activities"("user_id");

-- CreateIndex
CREATE INDEX "authorship_activities_session_start_idx" ON "authorship_activities"("session_start");

-- AddForeignKey
ALTER TABLE "authorship_activities" ADD CONSTRAINT "authorship_activities_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorship_activities" ADD CONSTRAINT "authorship_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
