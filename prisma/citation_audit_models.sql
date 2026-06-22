-- Citation audit persistence models.
-- This file mirrors backend/prisma/migrations/20260621000000_add_citation_audit_models/migration.sql.
-- The migrations directory is ignored by this repository, so keep this SQL as the tracked deployment reference.

-- CreateTable
CREATE TABLE IF NOT EXISTS "audit_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "project_id" TEXT,
    "document_id" TEXT,
    "status" TEXT NOT NULL,
    "current_stage" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "report" JSONB,

    CONSTRAINT "audit_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "audit_reports" (
    "id" TEXT NOT NULL,
    "audit_job_id" TEXT NOT NULL,
    "report_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "verification_evidence" (
    "id" TEXT NOT NULL,
    "audit_job_id" TEXT NOT NULL,
    "reference_index" INTEGER,
    "inline_start" INTEGER,
    "inline_end" INTEGER,
    "inline_text" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "evidence_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "integrity_score_snapshots" (
    "id" TEXT NOT NULL,
    "audit_job_id" TEXT NOT NULL,
    "integrity_index" DOUBLE PRECISION NOT NULL,
    "compliance_score" DOUBLE PRECISION NOT NULL,
    "score_breakdown" JSONB,
    "summary" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrity_score_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_jobs_user_id_idx" ON "audit_jobs"("user_id");
CREATE INDEX IF NOT EXISTS "audit_jobs_project_id_idx" ON "audit_jobs"("project_id");
CREATE INDEX IF NOT EXISTS "audit_jobs_document_id_idx" ON "audit_jobs"("document_id");
CREATE INDEX IF NOT EXISTS "audit_jobs_status_idx" ON "audit_jobs"("status");
CREATE INDEX IF NOT EXISTS "audit_jobs_created_at_idx" ON "audit_jobs"("created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "audit_reports_audit_job_id_key" ON "audit_reports"("audit_job_id");
CREATE INDEX IF NOT EXISTS "audit_reports_audit_job_id_idx" ON "audit_reports"("audit_job_id");
CREATE INDEX IF NOT EXISTS "audit_reports_created_at_idx" ON "audit_reports"("created_at");

CREATE INDEX IF NOT EXISTS "verification_evidence_audit_job_id_idx" ON "verification_evidence"("audit_job_id");
CREATE INDEX IF NOT EXISTS "verification_evidence_status_idx" ON "verification_evidence"("status");
CREATE INDEX IF NOT EXISTS "verification_evidence_created_at_idx" ON "verification_evidence"("created_at");

CREATE INDEX IF NOT EXISTS "integrity_score_snapshots_audit_job_id_idx" ON "integrity_score_snapshots"("audit_job_id");
CREATE INDEX IF NOT EXISTS "integrity_score_snapshots_created_at_idx" ON "integrity_score_snapshots"("created_at");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "audit_jobs" ADD CONSTRAINT "audit_jobs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "audit_jobs" ADD CONSTRAINT "audit_jobs_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "audit_reports" ADD CONSTRAINT "audit_reports_audit_job_id_fkey"
    FOREIGN KEY ("audit_job_id") REFERENCES "audit_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "verification_evidence" ADD CONSTRAINT "verification_evidence_audit_job_id_fkey"
    FOREIGN KEY ("audit_job_id") REFERENCES "audit_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "integrity_score_snapshots" ADD CONSTRAINT "integrity_score_snapshots_audit_job_id_fkey"
    FOREIGN KEY ("audit_job_id") REFERENCES "audit_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
