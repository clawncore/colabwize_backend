-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attachment_url" TEXT,
    "browser_info" TEXT,
    "os_info" TEXT,
    "screen_size" TEXT,
    "user_plan" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "votes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "implemented_at" TIMESTAMP(3),

    CONSTRAINT "feature_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_votes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "feature_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_tickets_user_id_idx" ON "support_tickets"("user_id");

-- CreateIndex
CREATE INDEX "support_tickets_status_idx" ON "support_tickets"("status");

-- CreateIndex
CREATE INDEX "support_tickets_priority_idx" ON "support_tickets"("priority");

-- CreateIndex
CREATE INDEX "support_tickets_created_at_idx" ON "support_tickets"("created_at");

-- CreateIndex
CREATE INDEX "feature_requests_user_id_idx" ON "feature_requests"("user_id");

-- CreateIndex
CREATE INDEX "feature_requests_status_idx" ON "feature_requests"("status");

-- CreateIndex
CREATE INDEX "feature_requests_category_idx" ON "feature_requests"("category");

-- CreateIndex
CREATE INDEX "feature_requests_votes_idx" ON "feature_requests"("votes");

-- CreateIndex
CREATE INDEX "feature_requests_created_at_idx" ON "feature_requests"("created_at");

-- CreateIndex
CREATE INDEX "feature_votes_user_id_idx" ON "feature_votes"("user_id");

-- CreateIndex
CREATE INDEX "feature_votes_feature_id_idx" ON "feature_votes"("feature_id");

-- CreateIndex
CREATE UNIQUE INDEX "feature_votes_user_id_feature_id_key" ON "feature_votes"("user_id", "feature_id");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_requests" ADD CONSTRAINT "feature_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_votes" ADD CONSTRAINT "feature_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_votes" ADD CONSTRAINT "feature_votes_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "feature_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
