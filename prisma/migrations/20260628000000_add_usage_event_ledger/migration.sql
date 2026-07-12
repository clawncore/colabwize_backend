-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "reference_id" TEXT,
    "metadata" JSONB,
    "error" TEXT,
    "held_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usage_events_reference_id_key" ON "usage_events"("reference_id");

-- CreateIndex
CREATE INDEX "usage_events_user_id_feature_held_at_idx" ON "usage_events"("user_id", "feature", "held_at");

-- CreateIndex
CREATE INDEX "usage_events_status_idx" ON "usage_events"("status");

-- CreateIndex
CREATE INDEX "usage_events_reference_id_idx" ON "usage_events"("reference_id");

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
