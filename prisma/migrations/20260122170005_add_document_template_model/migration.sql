-- AlterTable
ALTER TABLE "citations" ADD COLUMN     "formatted_citations" JSONB;

-- CreateTable
CREATE TABLE "document_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "user_id" TEXT,
    "citation_style" TEXT,
    "author_name" TEXT DEFAULT 'ColabWize',
    "rating" DOUBLE PRECISION DEFAULT 0,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_templates_type_idx" ON "document_templates"("type");

-- CreateIndex
CREATE INDEX "document_templates_is_public_idx" ON "document_templates"("is_public");

-- CreateIndex
CREATE INDEX "document_templates_user_id_idx" ON "document_templates"("user_id");
