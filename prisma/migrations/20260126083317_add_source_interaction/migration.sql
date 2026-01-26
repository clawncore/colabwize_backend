-- CreateTable
CREATE TABLE "source_interactions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_title" TEXT,
    "total_reading_time_ms" INTEGER NOT NULL DEFAULT 0,
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "last_read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "citation_added_at" TIMESTAMP(3),
    "is_cited" BOOLEAN NOT NULL DEFAULT false,
    "citation_preceded_by_reading" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_interactions_project_id_idx" ON "source_interactions"("project_id");

-- CreateIndex
CREATE INDEX "source_interactions_user_id_idx" ON "source_interactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_interactions_project_id_user_id_source_id_key" ON "source_interactions"("project_id", "user_id", "source_id");

-- AddForeignKey
ALTER TABLE "source_interactions" ADD CONSTRAINT "source_interactions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_interactions" ADD CONSTRAINT "source_interactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
