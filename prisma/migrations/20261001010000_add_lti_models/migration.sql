-- CreateTable
CREATE TABLE "lti_installation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issuer" TEXT NOT NULL,
    "client_id" TEXT NOT NULL UNIQUE,
    "auth_endpoint" TEXT NOT NULL,
    "token_endpoint" TEXT NOT NULL,
    "key_set_url" TEXT NOT NULL,
    "deployment_id" TEXT,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "lti_roster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installation_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "lti_user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lti_roster_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "lti_installation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lti_roster_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lti_roster_course_id_lti_user_id_key" UNIQUE ("course_id", "lti_user_id")
);

-- CreateIndex
CREATE INDEX "lti_roster_installation_id_idx" ON "lti_roster"("installation_id");

-- CreateIndex
CREATE INDEX "lti_roster_course_id_idx" ON "lti_roster"("course_id");