-- AlterTable
ALTER TABLE "authorship_activities" ADD COLUMN     "active_time" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ai_assisted_edits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cognitive_load" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "idle_time" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "manual_edits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "session_type" TEXT NOT NULL DEFAULT 'writing',
ADD COLUMN     "writing_pattern_score" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "real_time_activities" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content_before" TEXT,
    "content_after" TEXT,
    "cursor_position" INTEGER,
    "keystrokes" INTEGER DEFAULT 0,
    "ai_assisted" BOOLEAN NOT NULL DEFAULT false,
    "ai_model_used" TEXT,
    "session_type" TEXT NOT NULL DEFAULT 'writing',
    "idle_time" INTEGER DEFAULT 0,
    "active_time" INTEGER DEFAULT 0,
    "word_count" INTEGER DEFAULT 0,
    "selection_length" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "real_time_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "real_time_activities_project_id_idx" ON "real_time_activities"("project_id");

-- CreateIndex
CREATE INDEX "real_time_activities_user_id_idx" ON "real_time_activities"("user_id");

-- CreateIndex
CREATE INDEX "real_time_activities_timestamp_idx" ON "real_time_activities"("timestamp");

-- CreateIndex
CREATE INDEX "real_time_activities_event_type_idx" ON "real_time_activities"("event_type");

-- AddForeignKey
ALTER TABLE "real_time_activities" ADD CONSTRAINT "real_time_activities_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "real_time_activities" ADD CONSTRAINT "real_time_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
