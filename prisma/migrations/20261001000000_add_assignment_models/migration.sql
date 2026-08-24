-- CreateTable
CREATE TABLE "assignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "instructor_id" TEXT NOT NULL,
    "due_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "integrity_rules" JSON NOT NULL DEFAULT '{"aiAllowed": "outline", "collaborationAllowed": true, "citationRequired": true, "allowPeerFeedback": true}',
    "attestation_required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "assignment_member" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'student',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_member_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assignment_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "assignment_attestation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignment_id" TEXT NOT NULL,
    "project_id" TEXT,
    "user_id" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "rules_snapshot" JSON NOT NULL,

    CONSTRAINT "assignment_attestation_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assignment_attestation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "assignment_member_assignment_id_user_id_key" ON "assignment_member"("assignment_id", "user_id");

-- CreateIndex
CREATE INDEX "assignment_member_assignment_id_idx" ON "assignment_member"("assignment_id");

-- CreateIndex
CREATE INDEX "assignment_attestation_assignment_id_idx" ON "assignment_attestation"("assignment_id");

-- CreateIndex
CREATE INDEX "assignment_attestation_user_id_idx" ON "assignment_attestation"("user_id");