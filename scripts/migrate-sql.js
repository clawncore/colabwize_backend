#!/usr/bin/env node
/**
 * Manual SQL Migration Runner
 *
 * Reads .sql files from backend/sql/migrations/ in numeric order,
 * checks _sql_migrations table, applies unapplied files in a transaction.
 *
 * Usage:
 *   node scripts/migrate-sql.js --dry-run   # preview only
 *   node scripts/migrate-sql.js --apply     # actually run
 *   node scripts/migrate-sql.js             # same as --dry-run
 *
 * Safety:
 * - Never runs DROP unless the .sql file explicitly contains DROP.
 * - Runs each file in its own transaction (BEGIN/COMMIT).
 * - Records SHA-256 checksum of each file to detect tampering.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// Load .env
dotenv.config({ path: resolve(PROJECT_ROOT, '.env') });

const { Pool } = pg;
const MIGRATIONS_DIR = resolve(PROJECT_ROOT, 'sql', 'migrations');
const DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ No DATABASE_URL or DIRECT_URL found in .env');
  process.exit(1);
}

// Pool uses DIRECT_URL (port 5432) to avoid PgBouncer prepared statement issues
const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });

async function getAppliedMigrations() {
  const result = await pool.query('SELECT filename, checksum FROM _sql_migrations');
  const map = new Map();
  for (const row of result.rows) {
    map.set(row.filename, row.checksum);
  }
  return map;
}

function listMigrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) {
    return [];
  }
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort(); // numeric prefix ensures order
}

function readFileWithChecksum(filepath) {
  const content = readFileSync(filepath, 'utf-8');
  const checksum = createHash('sha256').update(content).digest('hex');
  return { content, checksum };
}

async function runMigration(file, content, dryRun) {
  const client = await pool.connect();
  try {
    if (!dryRun) {
      await client.query('BEGIN');
      // Split by semicolon (simple, works for our controlled SQL files)
      const statements = content.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for (const stmt of statements) {
        if (stmt.trim()) {
          await client.query(stmt);
        }
      }
      await client.query('COMMIT');
      console.log(`  ✅ Applied ${file}`);
    } else {
      console.log(`  🔍 Would apply ${file}`);
    }
    return true;
  } catch (err) {
    if (!dryRun) {
      await client.query('ROLLBACK');
    }
    console.error(`  ❌ Failed to apply ${file}:`, err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function recordMigration(filename, checksum) {
  await pool.query(
    'INSERT INTO _sql_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = NOW()',
    [filename, checksum]
  );
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    console.log(`
Manual SQL Migration Runner

Usage:
  npm run migrate:sql          # dry-run (default)
  npm run migrate:sql -- --dry-run
  npm run migrate:sql -- --apply

Files in sql/migrations/ are applied in alphabetical order.
Always run dry-run first, then --apply after reviewing.
`);
    process.exit(0);
  }

  console.log(`📂 Migrations dir: ${MIGRATIONS_DIR}`);
  console.log(`🔗 Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`🧪 Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);

  // Ensure tracking table exists (auto-created by 000_init if not present)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _sql_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum TEXT NOT NULL,
      UNIQUE (filename)
    )
  `);

  const applied = await getAppliedMigrations();
  const files = listMigrationFiles();

  if (files.length === 0) {
    console.log('ℹ️  No migration files found.');
    await pool.end();
    return;
  }

  let hasPending = false;
  for (const file of files) {
    const filepath = join(MIGRATIONS_DIR, file);
    const { content, checksum } = readFileWithChecksum(filepath);
    const prevChecksum = applied.get(file);

    if (prevChecksum) {
      if (prevChecksum !== checksum) {
        console.warn(`⚠️  ${file}: CHECKSUM MISMATCH (file modified after apply?)`);
        console.warn(`     recorded: ${prevChecksum}`);
        console.warn(`     current:  ${checksum}`);
      } else {
        console.log(`⏭️  Already applied: ${file}`);
      }
    } else {
      hasPending = true;
      await runMigration(file, content, dryRun);
      if (!dryRun) {
        await recordMigration(file, checksum);
      }
    }
  }

  if (!hasPending && !dryRun) {
    console.log('✅ No pending migrations.');
  } else if (hasPending && dryRun) {
    console.log('\n📋 Dry-run complete. Run with --apply to execute.');
  }

  await pool.end();
}

main().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});