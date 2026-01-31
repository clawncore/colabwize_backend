/*
  Warnings:

  - A unique constraint covering the columns `[reference_id,type]` on the table `credit_transactions` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "credit_balances" ALTER COLUMN "balance" SET DEFAULT 0,
ALTER COLUMN "balance" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "lifetime_purchased" SET DEFAULT 0,
ALTER COLUMN "lifetime_purchased" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "lifetime_used" SET DEFAULT 0,
ALTER COLUMN "lifetime_used" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "credit_transactions" ALTER COLUMN "amount" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "originality_scans" ADD COLUMN     "cost_amount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "match_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scanned_content" TEXT,
ADD COLUMN     "words_scanned" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "similarity_matches" ADD COLUMN     "match_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "matched_words" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source_words" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "view_url" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "entitlement_expires_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "auto_use_credits" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "editor_tour_completed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "editor_tour_skipped" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "policy_accepted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_entitlements" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "billing_cycle_start" TIMESTAMP(3) NOT NULL,
    "billing_cycle_end" TIMESTAMP(3) NOT NULL,
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rebuild_status" TEXT NOT NULL DEFAULT 'idle',
    "last_rebuilt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_alerts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "new_matches_count" INTEGER NOT NULL DEFAULT 0,
    "last_checked" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_topics" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sources" INTEGER NOT NULL DEFAULT 0,
    "sources_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_topics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_event_id_key" ON "webhook_events"("event_id");

-- CreateIndex
CREATE INDEX "webhook_events_event_id_idx" ON "webhook_events"("event_id");

-- CreateIndex
CREATE INDEX "webhook_events_provider_idx" ON "webhook_events"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "user_entitlements_user_id_key" ON "user_entitlements"("user_id");

-- CreateIndex
CREATE INDEX "user_entitlements_user_id_idx" ON "user_entitlements"("user_id");

-- CreateIndex
CREATE INDEX "search_alerts_user_id_idx" ON "search_alerts"("user_id");

-- CreateIndex
CREATE INDEX "search_alerts_frequency_idx" ON "search_alerts"("frequency");

-- CreateIndex
CREATE INDEX "research_topics_user_id_idx" ON "research_topics"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_transactions_reference_id_type_key" ON "credit_transactions"("reference_id", "type");

-- AddForeignKey
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_alerts" ADD CONSTRAINT "search_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_topics" ADD CONSTRAINT "research_topics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
