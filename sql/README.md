# Manual SQL Migration System

This replaces Prisma Migrate. **Schema changes are now hand-written SQL files** that you control.

## How It Works

1. **Migrations live in** `sql/migrations/` as numbered files:
   ```
   000_init_migrations_table.sql
   001_baseline_schema.sql          # (optional) full schema snapshot for new installs
   002_add_referral_reward.sql      # your referral feature
   003_add_user_preferences.sql     # next change
   ```

2. **Tracking table** `_sql_migrations` records which files ran and their checksums.

3. **Runner script** `scripts/migrate-sql.js`:
   - Reads files in alphabetical order
   - Skips already-applied files (checksum match)
   - Runs each in a transaction
   - Dry-run by default, `--apply` to execute

## Your Workflow (Every Time)

```bash
# 1. ALWAYS backup first
cd backend
npm run backup:local

# 2. Create your SQL file (copy/paste from a template or write by hand)
#    backend/sql/migrations/004_my_new_feature.sql

# 3. Preview what will happen
npm run migrate:sql -- --dry-run

# 4. Apply it
npm run migrate:sql -- --apply

# 5. Regenerate Prisma Client types to match new columns
npm run db:generate
```

## Safety Rules

- **Never** run `prisma db push`, `prisma migrate dev`, `prisma migrate reset`, `supabase db reset --linked`.
- **Never** write a `DROP TABLE` in a migration unless you really mean it and have a backup.
- **Always** `npm run backup:local` before `npm run migrate:sql -- --apply`.
- **Test locally** against a copy first if unsure.

## Writing Migration Files

Keep it simple — one file = one logical change:

```sql
-- 004_add_user_timezone.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';
CREATE INDEX IF NOT EXISTS users_timezone_idx ON users(timezone);
```

Use `IF NOT EXISTS` / `IF EXISTS` to make files idempotent (safe to re-run).

## Backup Location

Backups go to `backend/backups/` (gitignored):
- `colabwize-20260911-143022.dump` — custom format, use with `pg_restore`
- `colabwize-20260911-143022.sql.gz` — plain SQL, compressed, grep-able

To restore:
```bash
pg_restore --clean --if-exists --dbname="postgresql://..." backups/colabwize-20260911-143022.dump
```

## Nightly Automation (Optional)

Add a cron job on your machine or a GitHub Action with `DIRECT_URL` secret:
```yaml
# .github/workflows/nightly-backup.yml
on:
  schedule:
    - cron: '0 3 * * *'  # 3am UTC daily
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: cd backend && npm ci && npm run backup:local -- --keep 7
        env:
          DIRECT_URL: ${{ secrets.DIRECT_URL }}
      - # upload backups/ as artifact or to S3
```

## Why Not Prisma Migrate?

Prisma's `db push`/`migrate dev` **drops tables/columns not in your schema**. With a stale or partial `schema.prisma`, it wipes data — which is what happened here.

This system puts **you** in control. You write the `ALTER TABLE`, you decide when it runs, you keep the backup.