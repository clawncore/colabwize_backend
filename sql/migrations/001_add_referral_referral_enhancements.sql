-- Migration: Referral & Earn enhancements
-- Adds columns to track referee-side rewards, expiration reminders,
-- and an index supporting the UTC month-boundary monthly-limit COUNT.

--
-- These columns are ALREADY declared in prisma/schema.prisma (Referral model).
-- This migration backfills the live Postgres database so the Prisma client
-- types (regenerated via `npm run db:generate`) match the schema.
--
-- Idempotent: safe to re-run.


-- Refer-a-friend enhancements on the referrals table.
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referee_reward_granted BOOLEAN DEFAULT false;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referee_entitlement_expires TIMESTAMPTZ;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS expiration_reminder_sent BOOLEAN DEFAULT false;

-- Composite index to support the monthly-limit COUNT query in
-- processReferralReward:
--   WHERE referrer_id = ? AND reward_status = 'granted' AND referred_at >= monthStart
-- A covering index keeps the count O(log n) even under contention.
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_status_referred
  ON referrals (referrer_id, reward_status, referred_at DESC);
