-- Add Canonical Document Model (CDM) snapshot column to DocumentVersion.
-- Phase 1 of the Publishing Platform (docs/PUBLISHING_PLATFORM_ARCHITECTURE_PLAN.md).
-- Additive only: no destructive change, safe to roll back with DROP COLUMN.

ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS cdm JSONB;
