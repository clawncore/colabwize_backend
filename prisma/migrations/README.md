# ⚠️ HISTORICAL — DO NOT USE

This directory contains Prisma migration history **for reference only**.

**Do not run `prisma migrate dev`, `prisma migrate deploy`, or `prisma db push`.**
These commands can **DROP tables** that are missing from schema.prisma, causing total data loss.

## For Current Schema Changes

All new schema changes must be made via **manual SQL files** in:

```
backend/sql/migrations/
```

See `backend/sql/README.md` for instructions.

## Why This Is Here

This history is preserved so you can:
- Understand the evolution of tables
- Look up column types and constraints
- Reconstruct migration history if needed for debugging

**The source of truth for schema changes is NOW:** `backend/sql/migrations/`
