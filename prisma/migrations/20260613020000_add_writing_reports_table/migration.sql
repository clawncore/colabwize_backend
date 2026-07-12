-- Create writing_reports table for authorship algorithm evidence storage
-- Run via: cd backend && npx prisma migrate deploy

CREATE TABLE IF NOT EXISTS writing_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES auth.users(id),
  project_id text,
  document_name text NOT NULL,
  storage_path text NOT NULL,
  shared_id text UNIQUE NOT NULL,
  salt text NOT NULL,
  iv text NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT unique_shared_id UNIQUE (shared_id)
);

-- Enable RLS
ALTER TABLE writing_reports ENABLE ROW LEVEL SECURITY;

-- Policy: Owner can manage their own reports
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Users can manage their own reports' AND tablename = 'writing_reports'
  ) THEN
    CREATE POLICY "Users can manage their own reports"
    ON writing_reports
    FOR ALL
    TO authenticated
    USING (auth.uid() = owner_id);
  END IF;
END $$;

-- Policy: Anyone can read a report if they have the shared_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view shared reports' AND tablename = 'writing_reports'
  ) THEN
    CREATE POLICY "Anyone can view shared reports"
    ON writing_reports
    FOR SELECT
    TO public
    USING (true);
  END IF;
END $$;

-- Index for fast lookups by project
CREATE INDEX IF NOT EXISTS idx_writing_reports_project_id ON writing_reports(project_id);
CREATE INDEX IF NOT EXISTS idx_writing_reports_owner_id ON writing_reports(owner_id);
