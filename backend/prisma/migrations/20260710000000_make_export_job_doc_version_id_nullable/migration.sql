-- Make ExportJob.doc_version_id nullable so exports can be built from live
-- editor content (TipTap JSON) without a previously persisted DocumentVersion.
ALTER TABLE "ExportJob" ALTER COLUMN "doc_version_id" DROP NOT NULL;
