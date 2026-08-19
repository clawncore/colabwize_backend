-- CreateTable
CREATE TABLE "authorship_collaboration_sessions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "server_session_id" TEXT NOT NULL,
    "client_session_id" TEXT,
    "socket_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "authenticated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnected_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authorship_collaboration_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorship_evidence_batches" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT,
    "client_session_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'client_batch',
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "raw_payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'received',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authorship_evidence_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorship_evidence" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "collaboration_session_id" TEXT,
    "evidence_id" TEXT NOT NULL,
    "evidence_type" TEXT NOT NULL,
    "evidence_hash" TEXT,
    "source" TEXT NOT NULL,
    "strength" TEXT NOT NULL DEFAULT 'weak',
    "server_received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_timestamp" TIMESTAMP(3),
    "block_id" TEXT,
    "section_title" TEXT,
    "content_hash" TEXT,
    "inserted_chars" INTEGER NOT NULL DEFAULT 0,
    "deleted_chars" INTEGER NOT NULL DEFAULT 0,
    "edit_count" INTEGER NOT NULL DEFAULT 0,
    "ai_assisted" BOOLEAN NOT NULL DEFAULT false,
    "anomaly_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorship_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorship_contributions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "block_id" TEXT NOT NULL DEFAULT '__document',
    "section_title" TEXT,
    "inserted_chars" INTEGER NOT NULL DEFAULT 0,
    "deleted_chars" INTEGER NOT NULL DEFAULT 0,
    "edit_count" INTEGER NOT NULL DEFAULT 0,
    "server_observed_edits" INTEGER NOT NULL DEFAULT 0,
    "ai_assisted_edits" INTEGER NOT NULL DEFAULT 0,
    "offline_edits" INTEGER NOT NULL DEFAULT 0,
    "contribution_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "first_contribution_at" TIMESTAMP(3),
    "last_contribution_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authorship_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorship_anomalies" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT,
    "evidence_id" TEXT,
    "anomaly_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorship_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorship_confidence_reports" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "certificate_id" TEXT,
    "report_json" JSONB NOT NULL,
    "attribution_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contribution_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "collaboration_clarity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence_completeness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ai_transparency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "anomaly_risk" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overall_reliability" TEXT NOT NULL DEFAULT 'Insufficient',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorship_confidence_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "authorship_collaboration_sessions_server_session_id_key" ON "authorship_collaboration_sessions"("server_session_id");

-- CreateIndex
CREATE INDEX "authorship_collaboration_sessions_project_id_idx" ON "authorship_collaboration_sessions"("project_id");

-- CreateIndex
CREATE INDEX "authorship_collaboration_sessions_user_id_idx" ON "authorship_collaboration_sessions"("user_id");

-- CreateIndex
CREATE INDEX "authorship_collaboration_sessions_server_session_id_idx" ON "authorship_collaboration_sessions"("server_session_id");

-- CreateIndex
CREATE INDEX "authorship_collaboration_sessions_authenticated_at_idx" ON "authorship_collaboration_sessions"("authenticated_at");

-- CreateIndex
CREATE INDEX "authorship_evidence_batches_project_id_idx" ON "authorship_evidence_batches"("project_id");

-- CreateIndex
CREATE INDEX "authorship_evidence_batches_user_id_idx" ON "authorship_evidence_batches"("user_id");

-- CreateIndex
CREATE INDEX "authorship_evidence_batches_session_id_idx" ON "authorship_evidence_batches"("session_id");

-- CreateIndex
CREATE INDEX "authorship_evidence_batches_source_idx" ON "authorship_evidence_batches"("source");

-- CreateIndex
CREATE INDEX "authorship_evidence_batches_received_at_idx" ON "authorship_evidence_batches"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "authorship_evidence_evidence_id_key" ON "authorship_evidence"("evidence_id");

-- CreateIndex
CREATE INDEX "authorship_evidence_project_id_idx" ON "authorship_evidence"("project_id");

-- CreateIndex
CREATE INDEX "authorship_evidence_user_id_idx" ON "authorship_evidence"("user_id");

-- CreateIndex
CREATE INDEX "authorship_evidence_evidence_type_idx" ON "authorship_evidence"("evidence_type");

-- CreateIndex
CREATE INDEX "authorship_evidence_source_idx" ON "authorship_evidence"("source");

-- CreateIndex
CREATE INDEX "authorship_evidence_strength_idx" ON "authorship_evidence"("strength");

-- CreateIndex
CREATE INDEX "authorship_evidence_server_received_at_idx" ON "authorship_evidence"("server_received_at");

-- CreateIndex
CREATE INDEX "authorship_evidence_block_id_idx" ON "authorship_evidence"("block_id");

-- CreateIndex
CREATE INDEX "authorship_contributions_project_id_idx" ON "authorship_contributions"("project_id");

-- CreateIndex
CREATE INDEX "authorship_contributions_user_id_idx" ON "authorship_contributions"("user_id");

-- CreateIndex
CREATE INDEX "authorship_contributions_contribution_score_idx" ON "authorship_contributions"("contribution_score");

-- CreateIndex
CREATE UNIQUE INDEX "authorship_contributions_project_id_user_id_block_id_key" ON "authorship_contributions"("project_id", "user_id", "block_id");

-- CreateIndex
CREATE INDEX "authorship_anomalies_project_id_idx" ON "authorship_anomalies"("project_id");

-- CreateIndex
CREATE INDEX "authorship_anomalies_user_id_idx" ON "authorship_anomalies"("user_id");

-- CreateIndex
CREATE INDEX "authorship_anomalies_evidence_id_idx" ON "authorship_anomalies"("evidence_id");

-- CreateIndex
CREATE INDEX "authorship_anomalies_severity_idx" ON "authorship_anomalies"("severity");

-- CreateIndex
CREATE INDEX "authorship_anomalies_detected_at_idx" ON "authorship_anomalies"("detected_at");

-- CreateIndex
CREATE INDEX "authorship_confidence_reports_project_id_idx" ON "authorship_confidence_reports"("project_id");

-- CreateIndex
CREATE INDEX "authorship_confidence_reports_user_id_idx" ON "authorship_confidence_reports"("user_id");

-- CreateIndex
CREATE INDEX "authorship_confidence_reports_certificate_id_idx" ON "authorship_confidence_reports"("certificate_id");

-- CreateIndex
CREATE INDEX "authorship_confidence_reports_generated_at_idx" ON "authorship_confidence_reports"("generated_at");

-- AddForeignKey
ALTER TABLE "authorship_collaboration_sessions" ADD CONSTRAINT "authorship_collaboration_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorship_collaboration_sessions" ADD CONSTRAINT "authorship_collaboration_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorship_evidence_batches" ADD CONSTRAINT "authorship_evidence_batches_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorship_evidence_batches" ADD CONSTRAINT "authorship_evidence_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorship_evidence" ADD CONSTRAINT "authorship_evidence_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorship_evidence" ADD CONSTRAINT "authorship_evidence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorship_evidence" ADD CONSTRAINT "authorship_evidence_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "authorship_evidence_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorship_evidence" ADD CONSTRAINT "authorship_evidence_collaboration_session_id_fkey" FOREIGN KEY ("collaboration_session_id") REFERENCES "authorship_collaboration_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorship_contributions" ADD CONSTRAINT "authorship_contributions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorship_contributions" ADD CONSTRAINT "authorship_contributions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorship_anomalies" ADD CONSTRAINT "authorship_anomalies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorship_anomalies" ADD CONSTRAINT "authorship_anomalies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorship_anomalies" ADD CONSTRAINT "authorship_anomalies_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "authorship_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorship_confidence_reports" ADD CONSTRAINT "authorship_confidence_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorship_confidence_reports" ADD CONSTRAINT "authorship_confidence_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
