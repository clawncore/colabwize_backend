-- AlterTable
ALTER TABLE "real_time_activities" ADD COLUMN     "edit_type" TEXT,
ADD COLUMN     "operation_size" INTEGER DEFAULT 0,
ADD COLUMN     "session_id" TEXT;

-- CreateIndex
CREATE INDEX "real_time_activities_session_id_idx" ON "real_time_activities"("session_id");
