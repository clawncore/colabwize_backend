-- Admin Operations & Analytics Migration
-- Adds tables for Security Administration, System Monitoring, Platform Operations, and Analytics

-- ─────────────────── Security Administration ───────────────────

CREATE TABLE IF NOT EXISTS "security_events" (
  "id"         TEXT    NOT NULL,
  "user_id"    TEXT,
  "admin_id"   TEXT,
  "type"       TEXT    NOT NULL,
  "severity"   TEXT    NOT NULL DEFAULT 'info',
  "description" TEXT   NOT NULL,
  "ip_address"  TEXT,
  "user_agent"  TEXT,
  "metadata"    JSONB,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "security_events_type_idx" ON "security_events" ("type");
CREATE INDEX "security_events_severity_idx" ON "security_events" ("severity");
CREATE INDEX "security_events_user_id_idx" ON "security_events" ("user_id");
CREATE INDEX "security_events_admin_id_idx" ON "security_events" ("admin_id");
CREATE INDEX "security_events_created_at_idx" ON "security_events" ("created_at");

CREATE TABLE IF NOT EXISTS "login_audit" (
  "id"              TEXT    NOT NULL,
  "user_id"         TEXT    NOT NULL,
  "email"           TEXT    NOT NULL,
  "success"         BOOLEAN NOT NULL,
  "ip_address"      TEXT,
  "user_agent"      TEXT,
  "failure_reason"  TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "login_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_audit_user_id_idx" ON "login_audit" ("user_id");
CREATE INDEX "login_audit_email_idx" ON "login_audit" ("email");
CREATE INDEX "login_audit_created_at_idx" ON "login_audit" ("created_at");
CREATE INDEX "login_audit_success_idx" ON "login_audit" ("success");

CREATE TABLE IF NOT EXISTS "ip_allowlist" (
  "id"          TEXT    NOT NULL,
  "ip_address"  TEXT    NOT NULL,
  "cidr"        TEXT,
  "description" TEXT,
  "blocked"     BOOLEAN NOT NULL DEFAULT false,
  "reason"      TEXT,
  "created_by"  TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_allowlist_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_allowlist_ip_address_unique" UNIQUE ("ip_address")
);

CREATE INDEX "ip_allowlist_ip_address_idx" ON "ip_allowlist" ("ip_address");
CREATE INDEX "ip_allowlist_blocked_idx" ON "ip_allowlist" ("blocked");

CREATE TABLE IF NOT EXISTS "account_locks" (
  "id"         TEXT    NOT NULL,
  "user_id"    TEXT    NOT NULL,
  "locked_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unlocked_at" TIMESTAMP(3),
  "reason"     TEXT    NOT NULL,
  "locked_by"  TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "account_locks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_locks_user_id_unique" UNIQUE ("user_id")
);

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id"         TEXT    NOT NULL,
  "user_id"    TEXT    NOT NULL,
  "name"       TEXT    NOT NULL,
  "key_hash"   TEXT    NOT NULL,
  "last_four"  TEXT    NOT NULL,
  "permissions" JSONB NOT NULL DEFAULT '[]',
  "is_active"  BOOLEAN NOT NULL DEFAULT true,
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),

  CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_keys_key_hash_unique" UNIQUE ("key_hash")
);

CREATE INDEX "api_keys_user_id_idx" ON "api_keys" ("user_id");
CREATE INDEX "api_keys_is_active_idx" ON "api_keys" ("is_active");

-- ─────────────────── Platform Operations ───────────────────

CREATE TABLE IF NOT EXISTS "maintenance_windows" (
  "id"          TEXT    NOT NULL,
  "title"       TEXT    NOT NULL,
  "description" TEXT,
  "start_time"  TIMESTAMP(3) NOT NULL,
  "end_time"    TIMESTAMP(3) NOT NULL,
  "mode"        TEXT    NOT NULL DEFAULT 'scheduled',
  "created_by"  TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "maintenance_windows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "maintenance_windows_start_time_idx" ON "maintenance_windows" ("start_time");
CREATE INDEX "maintenance_windows_end_time_idx" ON "maintenance_windows" ("end_time");
CREATE INDEX "maintenance_windows_mode_idx" ON "maintenance_windows" ("mode");

CREATE TABLE IF NOT EXISTS "backup_records" (
  "id"           TEXT    NOT NULL,
  "type"         TEXT    NOT NULL,
  "status"       TEXT    NOT NULL DEFAULT 'pending',
  "size_bytes"   INT,
  "file_name"    TEXT,
  "storage_path" TEXT,
  "started_at"   TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "error_message" TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "backup_records_status_idx" ON "backup_records" ("status");
CREATE INDEX "backup_records_type_idx" ON "backup_records" ("type");
CREATE INDEX "backup_records_created_at_idx" ON "backup_records" ("created_at");

-- ─────────────────── Analytics ───────────────────

CREATE TABLE IF NOT EXISTS "platform_metrics" (
  "id"          TEXT    NOT NULL,
  "metric_name" TEXT    NOT NULL,
  "category"    TEXT    NOT NULL,
  "value"       DOUBLE PRECISION NOT NULL,
  "unit"        TEXT,
  "metadata"    JSONB,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "platform_metrics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_metrics_metric_name_idx" ON "platform_metrics" ("metric_name");
CREATE INDEX "platform_metrics_category_idx" ON "platform_metrics" ("category");
CREATE INDEX "platform_metrics_recorded_at_idx" ON "platform_metrics" ("recorded_at");
