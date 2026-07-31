-- Security settings migration
-- Add LoginHistory table and update UserSession fields

CREATE TABLE IF NOT EXISTS "login_history" (
  "id"            TEXT    NOT NULL,
  "user_id"       TEXT    NOT NULL,
  "device_info"   TEXT,
  "browser"       TEXT,
  "device_type"   TEXT,
  "ip_address"    TEXT,
  "location"      TEXT,
  "status"        TEXT    NOT NULL,
  "error_code"    TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "login_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_history_user_id_idx" ON "login_history" ("user_id");
CREATE INDEX "login_history_created_at_idx" ON "login_history" ("created_at");

ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "device_info" TEXT;
ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "browser" TEXT;
ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "device_type" TEXT;
ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "ip_address" TEXT;
ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "last_active" TIMESTAMP(3);
ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "is_current" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_unusual_logins" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notify_new_devices" BOOLEAN NOT NULL DEFAULT true;

-- Security Log table
CREATE TABLE IF NOT EXISTS "security_logs" (
  "id"           TEXT    NOT NULL,
  "user_id"      TEXT    NOT NULL,
  "event_type"   TEXT    NOT NULL,
  "description"  TEXT    NOT NULL,
  "ip_address"   TEXT,
  "user_agent"   TEXT,
  "device_info"  TEXT,
  "browser"      TEXT,
  "device_type"  TEXT,
  "location"     TEXT,
  "status"       TEXT    NOT NULL DEFAULT 'success',
  "metadata"     JSONB,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "security_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "security_logs_user_id_idx" ON "security_logs" ("user_id");
CREATE INDEX "security_logs_event_type_idx" ON "security_logs" ("event_type");
CREATE INDEX "security_logs_created_at_idx" ON "security_logs" ("created_at");