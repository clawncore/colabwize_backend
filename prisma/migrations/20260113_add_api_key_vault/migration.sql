-- CreateTable
CREATE TABLE "api_key_vault" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "env_var_name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_key_vault_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_key_vault_service_key" ON "api_key_vault"("service");
CREATE INDEX "api_key_vault_service_idx" ON "api_key_vault"("service");
