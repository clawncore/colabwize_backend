-- Upgrade Citation model to canonical form
-- 1. Add new columns to citations table
ALTER TABLE "citations"
  ADD COLUMN IF NOT EXISTS "authors" JSONB,
  ADD COLUMN IF NOT EXISTS "provider" TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "providerId" TEXT,
  ADD COLUMN IF NOT EXISTS "rawMetadata" JSONB,
  ADD COLUMN IF NOT EXISTS "identifiers" JSONB,
  ADD COLUMN IF NOT EXISTS "attachments" JSONB,
  ADD COLUMN IF NOT EXISTS "tags" JSONB,
  ADD COLUMN IF NOT EXISTS "isFavorite" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "readingStatus" TEXT DEFAULT 'unread',
  ADD COLUMN IF NOT EXISTS "authenticityScore" DOUBLE PRECISION DEFAULT 0;

-- 2. Make author nullable (was NOT NULL, now we have authors JSON)
ALTER TABLE "citations" ALTER COLUMN "author" DROP NOT NULL;

-- 3. Add new indexes
CREATE INDEX IF NOT EXISTS "citations_provider_idx" ON "citations"("provider");
CREATE INDEX IF NOT EXISTS "citations_providerId_idx" ON "citations"("providerId");
CREATE INDEX IF NOT EXISTS "citations_isFavorite_idx" ON "citations"("isFavorite");

-- 4. Create reference_collections table
CREATE TABLE IF NOT EXISTS "reference_collections" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "icon" TEXT,
  "type" TEXT NOT NULL DEFAULT 'collection',
  "is_smart" BOOLEAN NOT NULL DEFAULT false,
  "smart_rules" JSONB,
  "color" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reference_collections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reference_collections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects")("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reference_collections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "reference_collections_project_id_idx" ON "reference_collections"("project_id");
CREATE INDEX IF NOT EXISTS "reference_collections_user_id_idx" ON "reference_collections"("user_id");
CREATE INDEX IF NOT EXISTS "reference_collections_type_idx" ON "reference_collections"("type");

-- 5. Create collection_citations junction table
CREATE TABLE IF NOT EXISTS "collection_citations" (
  "id" TEXT NOT NULL,
  "collection_id" TEXT NOT NULL,
  "citation_id" TEXT NOT NULL,
  "note" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "collection_citations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "collection_citations_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "reference_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "collection_citations_citation_id_fkey" FOREIGN KEY ("citation_id") REFERENCES "citations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "collection_citations_collection_id_citation_id_key" ON "collection_citations"("collection_id", "citation_id");
CREATE INDEX IF NOT EXISTS "collection_citations_collection_id_idx" ON "collection_citations"("collection_id");
CREATE INDEX IF NOT EXISTS "collection_citations_citation_id_idx" ON "collection_citations"("citation_id");
