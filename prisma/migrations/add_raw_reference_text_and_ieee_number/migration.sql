-- Add raw_reference_text and ieee_number columns to citations table
ALTER TABLE "citations" ADD COLUMN "raw_reference_text" TEXT;
ALTER TABLE "citations" ADD COLUMN "ieee_number" INTEGER;

-- Index for IEEE number lookups
CREATE INDEX "citations_ieee_number_idx" ON "citations"("ieee_number");

-- Index for project_id + ieee_number compound lookups
CREATE INDEX "citations_project_ieee_idx" ON "citations"("project_id", "ieee_number");
