-- AlterTable
ALTER TABLE "citations" ADD COLUMN     "abstract" TEXT,
ADD COLUMN     "matrix_notes" TEXT,
ADD COLUMN     "themes" JSONB;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "citation_style" TEXT,
ADD COLUMN     "outline" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "two_factor_backup_codes" TEXT[],
ADD COLUMN     "two_factor_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "two_factor_secret" TEXT;

-- CreateTable
CREATE TABLE "annotations" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT,
    "type" TEXT NOT NULL,
    "color" TEXT,
    "coordinates" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "annotations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "annotations_file_id_idx" ON "annotations"("file_id");

-- CreateIndex
CREATE INDEX "annotations_user_id_idx" ON "annotations"("user_id");

-- AddForeignKey
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
