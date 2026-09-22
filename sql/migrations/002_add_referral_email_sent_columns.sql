-- Migration: Add email idempotency flags to referrals table
-- Prevents duplicate reward emails on retry

ALTER TABLE referrals
    ADD COLUMN IF NOT EXISTS referrer_email_sent BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS referee_email_sent  BOOLEAN NOT NULL DEFAULT FALSE;

-- Index to support email retry queries (find un-sent reward emails)
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_email_sent
    ON referrals(referrer_email_sent) WHERE reward_status = 'granted' AND referrer_email_sent = FALSE;

CREATE INDEX IF NOT EXISTS idx_referrals_referee_email_sent
    ON referrals(referee_email_sent) WHERE reward_status = 'granted' AND referee_email_sent = FALSE;
