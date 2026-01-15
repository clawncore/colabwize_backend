-- AlterTable
ALTER TABLE "users" ADD COLUMN     "retention_period" INTEGER;

-- CreateTable
CREATE TABLE "recycled_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "item_data" JSONB NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "restored_at" TIMESTAMP(3),

    CONSTRAINT "recycled_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recycled_items_user_id_idx" ON "recycled_items"("user_id");

-- CreateIndex
CREATE INDEX "recycled_items_item_type_idx" ON "recycled_items"("item_type");

-- CreateIndex
CREATE INDEX "recycled_items_deleted_at_idx" ON "recycled_items"("deleted_at");

-- CreateIndex
CREATE INDEX "recycled_items_expires_at_idx" ON "recycled_items"("expires_at");

-- CreateIndex
CREATE INDEX "recycled_items_restored_at_idx" ON "recycled_items"("restored_at");

-- AddForeignKey
ALTER TABLE "recycled_items" ADD CONSTRAINT "recycled_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
