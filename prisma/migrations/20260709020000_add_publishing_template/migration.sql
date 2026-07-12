-- Phase 4: Publishing Templates
-- Additive, non-destructive. Safe to apply on existing databases.

CREATE TABLE "PublishingTemplate" (
  "id"          TEXT    NOT NULL,
  "name"        TEXT    NOT NULL,
  "description" TEXT,
  "owner_id"    TEXT,
  "is_builtin"  BOOLEAN NOT NULL DEFAULT false,
  "format"      TEXT    NOT NULL,
  "csl_style"   TEXT    NOT NULL DEFAULT 'apa',
  "geometry"    JSONB   NOT NULL DEFAULT '{"size":"A4","margin":{"top":"1in","bottom":"1in","left":"1in","right":"1in"},"columns":1}'::jsonb,
  "variables"   JSONB   NOT NULL DEFAULT '[]'::jsonb,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PublishingTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublishingTemplate_owner_id_idx" ON "PublishingTemplate" ("owner_id");
CREATE INDEX "PublishingTemplate_is_builtin_idx" ON "PublishingTemplate" ("is_builtin");
