-- AlterTable
ALTER TABLE "_TaskLabels" ADD CONSTRAINT "_TaskLabels_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_TaskLabels_AB_unique";

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "snoozed_until" TIMESTAMP(3),
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_activity_enabled" BOOLEAN NOT NULL DEFAULT true,
    "project_activity_comments" BOOLEAN NOT NULL DEFAULT true,
    "project_activity_mentions" BOOLEAN NOT NULL DEFAULT true,
    "project_activity_changes" BOOLEAN NOT NULL DEFAULT true,
    "project_activity_shared" BOOLEAN NOT NULL DEFAULT true,
    "collaboration_enabled" BOOLEAN NOT NULL DEFAULT true,
    "collaboration_new_collaborator" BOOLEAN NOT NULL DEFAULT true,
    "collaboration_permission_changes" BOOLEAN NOT NULL DEFAULT true,
    "collaboration_comments_resolved" BOOLEAN NOT NULL DEFAULT true,
    "collaboration_real_time" BOOLEAN NOT NULL DEFAULT true,
    "collaboration_request_enabled" BOOLEAN NOT NULL DEFAULT true,
    "collaboration_request_collaborator_request" BOOLEAN NOT NULL DEFAULT true,
    "ai_features_enabled" BOOLEAN NOT NULL DEFAULT true,
    "ai_features_plagiarism_complete" BOOLEAN NOT NULL DEFAULT true,
    "ai_features_ai_limit" BOOLEAN NOT NULL DEFAULT true,
    "ai_features_new_features" BOOLEAN NOT NULL DEFAULT true,
    "ai_features_weekly_summary" BOOLEAN NOT NULL DEFAULT true,
    "account_billing_enabled" BOOLEAN NOT NULL DEFAULT true,
    "account_billing_payment_success" BOOLEAN NOT NULL DEFAULT true,
    "account_billing_payment_failed" BOOLEAN NOT NULL DEFAULT true,
    "account_billing_subscription_renewed" BOOLEAN NOT NULL DEFAULT true,
    "account_billing_subscription_expiring" BOOLEAN NOT NULL DEFAULT true,
    "account_billing_security_alerts" BOOLEAN NOT NULL DEFAULT true,
    "account_billing_subscription_created" BOOLEAN NOT NULL DEFAULT true,
    "account_billing_subscription_updated" BOOLEAN NOT NULL DEFAULT true,
    "account_billing_subscription_cancelled" BOOLEAN NOT NULL DEFAULT true,
    "account_billing_subscription_resumed" BOOLEAN NOT NULL DEFAULT true,
    "account_billing_subscription_expired" BOOLEAN NOT NULL DEFAULT true,
    "account_billing_payment_refunded" BOOLEAN NOT NULL DEFAULT true,
    "account_billing_invoice_available" BOOLEAN NOT NULL DEFAULT true,
    "product_updates_enabled" BOOLEAN NOT NULL DEFAULT true,
    "product_updates_new_features" BOOLEAN NOT NULL DEFAULT true,
    "product_updates_tips" BOOLEAN NOT NULL DEFAULT true,
    "product_updates_newsletter" BOOLEAN NOT NULL DEFAULT true,
    "product_updates_special_offers" BOOLEAN NOT NULL DEFAULT true,
    "writing_progress_enabled" BOOLEAN NOT NULL DEFAULT true,
    "writing_progress_document_deadline" BOOLEAN NOT NULL DEFAULT true,
    "writing_progress_writing_streak" BOOLEAN NOT NULL DEFAULT true,
    "writing_progress_goal_achieved" BOOLEAN NOT NULL DEFAULT true,
    "research_updates_enabled" BOOLEAN NOT NULL DEFAULT true,
    "research_updates_ai_suggestion" BOOLEAN NOT NULL DEFAULT true,
    "research_updates_citation_reminder" BOOLEAN NOT NULL DEFAULT true,
    "research_updates_research_update" BOOLEAN NOT NULL DEFAULT true,
    "document_management_enabled" BOOLEAN NOT NULL DEFAULT true,
    "document_management_backup_available" BOOLEAN NOT NULL DEFAULT true,
    "document_management_template_update" BOOLEAN NOT NULL DEFAULT true,
    "document_management_document_version" BOOLEAN NOT NULL DEFAULT true,
    "sms_notifications_enabled" BOOLEAN NOT NULL DEFAULT false,
    "sms_notifications_high_priority_only" BOOLEAN NOT NULL DEFAULT true,
    "frequency" TEXT NOT NULL DEFAULT 'realtime',
    "quiet_hours_enabled" BOOLEAN NOT NULL DEFAULT false,
    "quiet_hours_start_time" TEXT NOT NULL DEFAULT '22:00',
    "quiet_hours_end_time" TEXT NOT NULL DEFAULT '08:00',
    "push_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "push_notifications_mentions" BOOLEAN NOT NULL DEFAULT true,
    "push_notifications_comments" BOOLEAN NOT NULL DEFAULT true,
    "push_notifications_direct_messages" BOOLEAN NOT NULL DEFAULT true,
    "push_notifications_marketing" BOOLEAN NOT NULL DEFAULT false,
    "in_app_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "in_app_notifications_sound" BOOLEAN NOT NULL DEFAULT true,
    "in_app_notifications_desktop" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_user_id_key" ON "notification_settings"("user_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
