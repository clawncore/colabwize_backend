-- Phase 3: Export Job System
-- Additive, non-destructive. Safe to apply on existing databases.

CREATE TYPE "ExportJobStatus" AS ENUM (
  'QUEUED', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'CANCELLED'
);

CREATE TABLE "ExportJob" (
  "id"                 TEXT NOT NULL,
  "user_id"            TEXT NOT NULL,
  "project_id"         TEXT,
  "doc_version_id"     TEXT NOT NULL,
  "format"             TEXT NOT NULL,
  "status"             "ExportJobStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts"           INTEGER NOT NULL DEFAULT 0,
  "max_attempts"       INTEGER NOT NULL DEFAULT 3,
  "progress"           INTEGER NOT NULL DEFAULT 0,
  "status_message"     TEXT,
  "settings"           JSONB NOT NULL DEFAULT '{}'::jsonb,
  "artifact_path"      TEXT,
  "artifact_url"       TEXT,
  "artifact_mime_type" TEXT,
  "artifact_size"      INTEGER,
  "artifact_checksum"  TEXT,
  "billing_event_id"   TEXT,
  "error"              TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  "started_at"         TIMESTAMP(3),
  "completed_at"       TIMESTAMP(3),

  CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExportJob_user_id_idx" ON "ExportJob" ("user_id");
CREATE INDEX "ExportJob_status_idx" ON "ExportJob" ("status");
CREATE INDEX "ExportJob_doc_version_id_idx" ON "ExportJob" ("doc_version_id");

ALTER TABLE "ExportJob"
  ADD CONSTRAINT "ExportJob_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
