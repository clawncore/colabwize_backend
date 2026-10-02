import { prisma } from "../lib/prisma";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { EmailService } from "./emailService";
import logger from "../monitoring/logger";
import { SecretsService } from "./secrets-service";
import { EntitlementService } from "./EntitlementService";
import { SecurityLogService } from "./securityLogService";
import { SecurityService } from "./securityService";
import {
  detectBrowser,
  detectDeviceType,
  formatIpAddress,
  isLoopbackAddress,
} from "../utils/browserDetection";
import { getLocationFromIp, getPublicIp } from "../utils/ipGeolocation";

/**
 * Optional request context used only for abuse-signal correlation.
 * NEVER used to block, downgrade, or penalize legitimate referrals.
 */
export interface ReferralRequestContext {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Service for Hybrid Authentication (Supabase + Custom Backend)
 */
export class HybridAuthService {
  /**
   * Register an OAuth user (post-callback)
   */
  static async registerOAuthUser(data: {
    id: string;
    email: string;
    fullName?: string;
    provider?: string;
    affiliate_ref?: string;
  }): Promise<{ success: boolean; message: string; user?: any }> {
    try {
      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { id: data.id },
      });

      if (existingUser) {
        // User already exists, maybe update info?
        return {
          success: true,
          message: "User already exists",
          user: existingUser,
        };
      }

      // Check if email exists (conflict?)
      const emailUser = await prisma.user.findUnique({
        where: { email: data.email },
      });

      if (emailUser) {
        // This means a user exists with this email but different ID?
        // This shouldn't happen if Supabase handles linking, but if it does:
        // We might need to link them. But for now, let's assume Supabase IDs match.
        // If Supabase ID != emailUser.id, we have a problem.
        if (emailUser.id !== data.id) {
          logger.warn("OAuth ID mismatch for existing email", {
            email: data.email,
            dbId: emailUser.id,
            oauthId: data.id,
          });
          // We could return success if we assume they are the same person, or handle merge logic.
        }
        return {
          success: true,
          message: "User found via email",
          user: emailUser,
        };
      }

      // Generate referral code
      const referralCode = await this.generateReferralCode(data.fullName);

      // Create user with referral code
      const user = await prisma.user.create({
        data: {
          id: data.id,
          email: data.email,
          full_name: data.fullName,
          email_verified: true, // OAuth is verified
          survey_completed: false,
          referral_code: referralCode,
        },
      });

      // Check for admin promotion
      // Admin promotion is now controlled exclusively through the admin_users table.
        // Legacy hardcoded email whitelisting removed as privilege escalation fix.

      // Process referral BEFORE creating the free subscription so the
      // free sub doesn't clobber a Plus reward (mirrors signUp logic).
      let referralResult = { rewardGranted: false, refereeRewardGranted: false };
      if (data.affiliate_ref) {
        referralResult = await this.processReferralReward(
          data.id,
          data.affiliate_ref,
        );
      }

      // Create default free subscription ONLY if not upgraded via referral
      if (!referralResult.rewardGranted) {
        await prisma.subscription.create({
          data: {
            user_id: data.id,
            plan: "free",
            status: "active",
          },
        });
      }

      // Send welcome email immediately for OAuth users (since they are already verified)
      try {
        await EmailService.sendWelcomeEmail(data.email, data.fullName || "");
      } catch (emailError: any) {
        logger.error("Failed to send welcome email to OAuth user", {
          email: data.email,
          error: emailError.message,
        });
        // We log the error but don't fail the registration process
      }

      return {
        success: true,
        message: "User registered successfully",
        user,
      };
    } catch (error: any) {
      logger.error("OAuth registration failed", { error: error.message });
      throw error;
    }
  }

  /**
   * Sync User Session (Signin)
   * Verifies the Supabase ID token and ensures user exists in our database
   */
  static async syncUserSession(
    idToken: string,
  ): Promise<{
    success: boolean;
    error?: string;
    user?: any;
    requires_2fa?: boolean;
  }> {
    try {
      const supabaseAdmin = await getSupabaseAdminClient();
      if (!supabaseAdmin) {
        throw new Error("Supabase admin client not available");
      }

      console.time("Supabase:getUser");
      // Verify the token by getting the user
      const {
        data: { user: supabaseUser },
        error,
      } = await supabaseAdmin.auth.getUser(idToken);
      console.timeEnd("Supabase:getUser");

      if (error || !supabaseUser) {
        logger.warn("Invalid ID token during sync", { error: error?.message });
        return { success: false, error: "Invalid session" };
      }

      // Check if user exists in our DB
      const dbUser = await prisma.user.findUnique({
        where: { id: supabaseUser.id },
      });

      if (!dbUser) {
        logger.info("Syncing new user from Supabase to Postgres", {
          userId: supabaseUser.id,
        });

        // Extract metadata
        const metadata = supabaseUser.user_metadata || {};
        const email = supabaseUser.email!; // Email returns string | undefined

        // CHECK FOR EXISTING EMAIL TO PREVENT CONFLICT
        const existingEmailUser = await prisma.user.findUnique({
          where: { email },
        });
        if (existingEmailUser) {
          logger.error(
            "CONFLICT: User found with same email but different ID",
            {
              email,
              existingId: existingEmailUser.id,
              newId: supabaseUser.id,
            },
          );

          // Debug 2FA status
          logger.info("Conflict User 2FA Status", {
            userId: existingEmailUser.id,
            enabled: existingEmailUser.two_factor_enabled,
          });

          // Return existing user and explicitly flag 2FA if enabled
          return {
            success: true,
            user: existingEmailUser,
            requires_2fa: existingEmailUser.two_factor_enabled, // Explicitly pass this
          };
        }

        // Determine if this is a truly new user or a returning user being synced for the first time
        // If the user was created more than 5 minutes ago, they're a returning user
        const userCreatedAt = new Date(supabaseUser.created_at);
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const isNewUser = userCreatedAt > fiveMinutesAgo;

        // Generate referral code for synced user
        const syncReferralCode = await this.generateReferralCode(metadata.full_name || metadata.name || "");

        // Create user in our DB
        const newUser = await prisma.user.create({
          data: {
            id: supabaseUser.id,
            email: email,
            full_name: metadata.full_name || metadata.name || "",
            email_verified: !!supabaseUser.email_confirmed_at, // Trust Supabase verification status
            survey_completed: false, // Ensure all newly synced users see the survey
            otp_method: "email",
            referral_code: syncReferralCode,
          },
        });

        // Create default free subscription for synced user
        await prisma.subscription.create({
          data: {
            user_id: supabaseUser.id,
            plan: "free",
            status: "active",
          },
        });

        // Admin promotion is now controlled exclusively through the admin_users table.
        // Legacy hardcoded email whitelisting removed as privilege escalation fix.

        return { success: true, user: newUser };
      } else {
        // Optional: Update email verification status if changed
        if (supabaseUser.email_confirmed_at && !dbUser.email_verified) {
          await prisma.user.update({
            where: { id: dbUser.id },
            data: { email_verified: true },
          });
        }

        return { success: true, user: dbUser };
      }
    } catch (error: any) {
      logger.error("Sync user session failed", { error: error.message });
      return { success: false, error: "Sync failed" };
    }
  }

  /**
   * Generate a 6-digit OTP code
   */
  private static generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Generate a unique referral code
   * Format: NAME_PREFIX + RANDOM (e.g., "MAROE8X3A")
   */
  private static async generateReferralCode(fullName?: string): Promise<string> {
    const prefix = fullName 
      ? fullName.replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase()
      : 'USER';
    
    const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
    let code = `${prefix}${randomPart}`;
    
    // Ensure uniqueness
    let attempts = 0;
    while (attempts < 5) {
      const existing = await prisma.user.findUnique({
        where: { referral_code: code },
      });
      
      if (!existing) {
        return code;
      }
      
      // Generate new random part if collision
      const newRandom = Math.random().toString(36).substring(2, 6).toUpperCase();
      code = `${prefix}${newRandom}`;
      attempts++;
    }
    
    // Fallback to UUID prefix if all attempts failed
    return `${prefix}${Date.now().toString(36).toUpperCase().slice(-4)}`;
  }

  /**
   * Reward duration in days granted to both referrer and referee.
   */
  private static readonly REWARD_DAYS = 5;

  /**
   * Maximum successful referrals rewarded per referrer per UTC calendar month.
   * Auto-resets at 00:00 UTC on the 1st of each month — no cron needed; the
   * COUNT query naturally moves its boundary.
   */
  private static readonly REWARD_LIMIT_PER_MONTH = 1;

  /**
   * Whether a subscription row counts as free-tier for reward eligibility.
   * A row stuck at plan='plus'/status='active' with a past
   * entitlement_expires_at (expired referral grant or missed LS webhook)
   * must be treated as free, otherwise the user can never earn another
   * referral reward. Mirrors SubscriptionService.getActivePlan.
   */
  private static isFreeTier(sub: any): boolean {
    if (!sub || sub.plan === "free") return true;
    if (
      sub.entitlement_expires_at &&
      new Date() > new Date(sub.entitlement_expires_at as any)
    )
      return true;
    return false;
  }

  /**
   * Compute the UTC calendar-month start for "now".
   * Mirrors the pattern in EntitlementService.rebuildEntitlements so the
   * monthly boundary is identical across the codebase.
   */
  private static monthStartUtc(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  /**
   * Process referral reward when a new user signs up with a referral code.
   *
   * Grants +REWARD_DAYS of Plus (`subscription.plan="plus"` +
   * `entitlement_expires_at`) to BOTH referee and referrer when either is on
   * the free tier (paid-tier users are left untouched — they already qualify).
   *
   * Enforces a 1-successful-referral-per-referrer-per-UTC-month limit using a
   * transactional COUNT — race-safe, no extra User columns required.
   *
   * Returns the reward outcome so the caller (signUp) can decide whether to
   * create a fallback free subscription for the referee.
   */
  private static async processReferralReward(
    refereeId: string,
    referralCode: string,
    requestContext?: ReferralRequestContext,
  ): Promise<{ rewardGranted: boolean; refereeRewardGranted: boolean }> {
    type ReferralResult = {
      rewardGranted: boolean;
      refereeRewardGranted: boolean;
      referrerEmail?: string;
      refereeEmail?: string;
      referrerId?: string;
      referrerFullName?: string;
      refereeFullName?: string;
      referralCode: string;
    };

    const noReward: ReferralResult = {
      rewardGranted: false,
      refereeRewardGranted: false,
      referralCode,
    };
    const now = new Date();

    let txResult: ReferralResult;

    try {
      txResult = await prisma.$transaction(async (tx: any) => {
        // 1. Find referrer by code
        const referrer = await tx.user.findUnique({
          where: { referral_code: referralCode },
        });

        if (!referrer) {
          logger.warn("Referral code not found", { referralCode });
          return noReward;
        }

        // 2. Prevent self-referral
        if (referrer.id === refereeId) {
          logger.warn("Self-referral attempt blocked", { userId: refereeId });
          return noReward;
        }

        // 3. Check if referee already used a referral code (unique constraint + guard)
        const existingReferral = await tx.referral.findUnique({
          where: { referee_id: refereeId },
        });

        if (existingReferral) {
          logger.warn("Referee already used a referral code", { refereeId });
          return noReward;
        }

        // 4. Monthly limit: count *successful* referrals granted this UTC month.
        //    This is the single source of truth for the 1-referral/month cap.
        const monthStart = HybridAuthService.monthStartUtc(now);
        const rewardedThisMonth = await tx.referral.count({
          where: {
            referrer_id: referrer.id,
            reward_status: "granted",
            referred_at: { gte: monthStart },
          },
        });

        const expiresAt = new Date(
          now.getTime() + HybridAuthService.REWARD_DAYS * 24 * 60 * 60 * 1000,
        );

        if (rewardedThisMonth >= HybridAuthService.REWARD_LIMIT_PER_MONTH) {
          // Limit reached this month — log the attempt but don't create a
          // referral row. Creating a monthly_limit_reached row would hit the
          // referee_id unique constraint and prevent a legitimate referral
          // in the next UTC month after the auto-reset.
          logger.info("Monthly referral limit reached for referrer", {
            referrerId: referrer.id,
            refereeId,
            monthStart,
          });
          return noReward;
        }

        // 5. Create the referral record (reward is granted atomically)
        await tx.referral.create({
          data: {
            referrer_id: referrer.id,
            referee_id: refereeId,
            reward_status: "granted",
            reward_expires_at: expiresAt,
            referee_reward_granted: false, // set true below if referee was upgraded
            referee_entitlement_expires: null,
            referrer_email_sent: false,    // idempotency flags for email retries
            referee_email_sent: false,
          },
        });

        let refereeRewardGranted = false;

        // 6. Grant referee reward (if on free tier — mirrors referrer logic)
        // Expiry-aware: an expired referral grant leaves plan='plus' on the
        // row, so check effective tier, not the raw column.
        const refereeSub = await tx.subscription.findUnique({
          where: { user_id: refereeId },
        });

        if (HybridAuthService.isFreeTier(refereeSub)) {
          if (!refereeSub) {
            await tx.subscription.create({
              data: {
                user_id: refereeId,
                plan: "plus",
                status: "active",
                entitlement_expires_at: expiresAt,
              },
            });
          } else {
            await tx.subscription.update({
              where: { user_id: refereeId },
              data: {
                plan: "plus",
                status: "active",
                entitlement_expires_at: expiresAt,
              },
            });
          }
          refereeRewardGranted = true;
          await tx.referral.update({
            where: { referee_id: refereeId },
            data: {
              referee_reward_granted: true,
              referee_entitlement_expires: expiresAt,
            },
          });
        }

        // 7. Grant referrer reward (if on free tier — expiry-aware, see above)
        const referrerSub = await tx.subscription.findUnique({
          where: { user_id: referrer.id },
        });

        if (HybridAuthService.isFreeTier(referrerSub)) {
          if (!referrerSub) {
            await tx.subscription.create({
              data: {
                user_id: referrer.id,
                plan: "plus",
                status: "active",
                entitlement_expires_at: expiresAt,
              },
            });
          } else {
            await tx.subscription.update({
              where: { user_id: referrer.id },
              data: {
                plan: "plus",
                status: "active",
                entitlement_expires_at: expiresAt,
              },
            });
          }
          logger.info("Referral reward granted", {
            referrerId: referrer.id,
            refereeId,
            refereeRewardGranted,
            expiresAt,
          });
        } else {
          logger.info("Referrer already on paid plan, referral logged without upgrade", {
            referrerId: referrer.id,
            currentPlan: referrerSub.plan,
          });
        }

        // Resolve the referee's email/name for the reward email. This is a
        // read-only lookup inside the transaction and does not lock the
        // referral row.
        const referee = await tx.user.findUnique({
          where: { id: refereeId },
          select: {
            email: true,
            full_name: true,
          },
        });

        // Return the domain + referee contact info so the caller can emit
        // best-effort audit signals OUTSIDE the transaction (a SecurityLog
        // write failure must never roll back a valid reward).
        return {
          rewardGranted: true,
          refereeRewardGranted,
          referrerEmail: referrer.email,
          refereeEmail: referee?.email,
          referrerId: referrer.id,
          referrerFullName: referrer.full_name,
          refereeFullName: referee?.full_name,
          referralCode,
        };
      });

    // ── Non-transactional side effects ──────────────────────────────
    // Emails and entitlement rebuilds run OUTSIDE $transaction so a
    // transient email-service or entitlement failure cannot roll back
    // the already-committed reward in the DB. These are best-effort —
    // failures are logged but never propagated to the signup flow.
    if (txResult.rewardGranted) {
      const rewardExpiresAt = new Date(
        now.getTime() + HybridAuthService.REWARD_DAYS * 24 * 60 * 60 * 1000,
      );

      try {
        // Atomically claim the email-send: only update referrer_email_sent
        // from false→true if it's currently false. This prevents a race
        // where two concurrent retry processes both send the email.
        // updateMany with the where clause acts as a compare-and-swap.
        const claimed = await prisma.referral.updateMany({
          where: {
            referee_id: refereeId,
            referrer_email_sent: false,
          },
          data: { referrer_email_sent: true },
        });

        if (claimed.count > 0) {
          await EmailService.sendReferralRewardEmail(
            txResult.referrerEmail ?? "",
            txResult.referrerFullName ?? "",
            HybridAuthService.REWARD_DAYS,
            rewardExpiresAt,
          );
          logger.info("REFERRAL_EMAIL_SENT", {
            type: "referrer",
            referrerId: txResult.referrerId,
            refereeId,
            referralCode,
          });
        } else {
          logger.info("REFERRAL_EMAIL_ALREADY_SENT", {
            type: "referrer",
            referrerId: txResult.referrerId,
            refereeId,
            referralCode,
          });
        }
      } catch (emailError: any) {
        logger.warn("REFERRAL_EMAIL_FAILED", {
          type: "referrer",
          referrerId: txResult.referrerId,
          refereeId,
          error: emailError.message,
        });
        // Best-effort: reset the flag so a retry can attempt to send
        // (EmailService.sendReferralRewardEmail is idempotent on its own
        // by recipient+template, but the flag is our guard at the DB level)
        await prisma.referral.updateMany({
          where: { referee_id: refereeId },
          data: { referrer_email_sent: false },
        }).catch(() => {});
      }

      if (txResult.refereeRewardGranted) {
        try {
          // Atomically claim the email-send to prevent double-delivery
          // under concurrent retries (compare-and-swap via updateMany WHERE)
          const claimed = await prisma.referral.updateMany({
            where: {
              referee_id: refereeId,
              referee_email_sent: false,
            },
            data: { referee_email_sent: true },
          });

          if (claimed.count > 0) {
            await EmailService.sendRefereeRewardEmail(
              txResult.refereeEmail ?? "",
              txResult.refereeFullName ?? "",
              txResult.referrerFullName ?? "",
              HybridAuthService.REWARD_DAYS,
              rewardExpiresAt,
            );
            logger.info("REFERRAL_EMAIL_SENT", {
              type: "referee",
              refereeId,
              referrerId: txResult.referrerId,
              referralCode,
            });
          } else {
            logger.info("REFERRAL_EMAIL_ALREADY_SENT", {
              type: "referee",
              refereeId,
              referrerId: txResult.referrerId,
              referralCode,
            });
          }
        } catch (emailError: any) {
          logger.warn("REFERRAL_EMAIL_FAILED", {
            type: "referee",
            refereeId,
            referrerId: txResult.referrerId,
            error: emailError.message,
          });
          // Best-effort: reset the flag so a retry can attempt to send
          await prisma.referral.updateMany({
            where: { referee_id: refereeId },
            data: { referee_email_sent: false },
          }).catch(() => {});
        }
      }

      // Rebuild entitlements for both users so plan + expiry are
      // immediately consistent in their Supabase JWT. Referrer ID may be
      // undefined if the transaction returned a noReward sentinel, so guard
      // against that here.
      if (txResult.referrerId) {
        try {
          await EntitlementService.rebuildEntitlements(txResult.referrerId);
        } catch (entErr: any) {
          logger.warn("Entitlement rebuild failed for referrer (non-blocking)", {
            referrerId: txResult.referrerId,
            error: entErr.message,
          });
        }
      }

      try {
        await EntitlementService.rebuildEntitlements(refereeId);
      } catch (entErr: any) {
        logger.warn("Entitlement rebuild failed for referee (non-blocking)", {
          refereeId,
          error: entErr.message,
        });
      }
    }

    // ── Abuse signal: same email domain ──────────────────────────────────
    // Log a WARN when the referrer and referee share an email domain.
    // This is a SIGNAL for manual review — never an automated block.
    // Legitimate cases (family, roommates, university cohort, company)
    // share domains all the time; the flag helps ops investigate patterns
    // of systematic abuse without penalizing real referrals.
    //
    // This runs OUTSIDE prisma.$transaction so audit-log write failures
    // cannot roll back the already-committed reward. We use
    // SecurityLogService.logEvent which catches its own errors.
    await HybridAuthService.logReferralRelationship(
      txResult.referrerId ?? "",
      refereeId,
      txResult.referralCode,
      txResult.referrerEmail,
      txResult.refereeEmail,
      requestContext,
    );

    return txResult;
  } catch (error: any) {
    logger.error("Failed to process referral reward", {
      error: error.message,
      refereeId,
      referralCode,
    });
    // Don't throw — referral failure must not block signup
    return noReward;
  }
}

  /**
   * Resolve the canonical email domain for an email address.
   */
  private static getEmailDomain(email?: string): string | undefined {
    if (!email) return undefined;
    const domain = email.split("@")[1]?.toLowerCase();
    return domain || undefined;
  }

  /**
   * Log a referral relationship for manual review without blocking signup.
   */
  private static async logReferralRelationship(
    referrerId: string,
    refereeId: string,
    referralCode: string,
    referrerEmail?: string,
    refereeEmail?: string,
    requestContext?: ReferralRequestContext,
  ): Promise<void> {
    const referrerDomain = HybridAuthService.getEmailDomain(referrerEmail);
    const refereeDomain = HybridAuthService.getEmailDomain(refereeEmail);
    const sameDomain =
      !!referrerDomain &&
      !!refereeDomain &&
      referrerDomain === refereeDomain;

    const logPayload = {
      referrerId,
      refereeId,
      referralCode,
      referrerEmail,
      refereeEmail,
      referrerDomain,
      refereeDomain,
      ipAddress: requestContext?.ipAddress,
      userAgent: requestContext?.userAgent,
      sameDomain,
    };

    logger.info("Referral relationship recorded", logPayload);

    if (sameDomain) {
      logger.warn("Referral domain match — flag for manual review", logPayload);
    }

    try {
      await SecurityLogService.logEvent({
        user_id: refereeId,
        event_type: "referral_relationship",
        description:
          sameDomain
            ? `Referral relationship flagged for manual review: referee used a referral from the same email domain. No automated action was taken.`
            : "Referral relationship recorded for attribution.",
        ip_address: requestContext?.ipAddress,
        user_agent: requestContext?.userAgent,
        status: sameDomain ? "warning" : "success",
        metadata: logPayload,
      });
    } catch (auditError: any) {
      logger.warn("Referral relationship audit log failed (non-blocking)", {
        refereeId,
        error: auditError.message,
      });
    }
  }

  /**
   * Check if email exists and is verified
   */
  static async checkEmail(email: string): Promise<{
    exists: boolean;
    confirmed: boolean;
  }> {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return { exists: false, confirmed: false };
    }

    return {
      exists: true,
      confirmed: user.email_verified,
    };
  }

  /**
   * Sign up a new user
   */
  static async signUp(
    email: string,
    password: string,
    userData: {
      full_name?: string;
      phone_number?: string;
      otp_method?: string;
      user_type?: string;
      field_of_study?: string;
      selected_plan?: string;
      affiliate_ref?: string;
    },
    requestContext?: ReferralRequestContext,
  ): Promise<{
    success: boolean;
    user?: any;
    message: string;
    otpSent?: boolean;
    needsVerification?: boolean;
  }> {
    try {
      // 1. Check if user exists in our database
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        return {
          success: false,
          message: "User with this email already exists",
        };
      }

      // 2. Check if username (full_name) is already taken
      if (userData.full_name) {
        const existingUsername = await prisma.user.findFirst({
          where: {
            full_name: {
              equals: userData.full_name,
              mode: "insensitive", // Case-insensitive search
            },
          },
        });

        if (existingUsername) {
          return {
            success: false,
            message: "Username already taken",
          };
        }
      }

      // 3. Create user in Supabase Auth
      const supabaseAdmin = await getSupabaseAdminClient();
      if (!supabaseAdmin) {
        throw new Error("Supabase admin client not available");
      }

      // We auto-confirm in Supabase because we handle verification ourselves via OTP
      const { data: supabaseUser, error: supabaseError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: userData.full_name,
          },
        });

      if (supabaseError) {
        // Normalize known Supabase errors into safe application errors
        // Avoid leaking internal provider error details to the client
        const supabaseErrMsg = supabaseError.message?.toLowerCase() || "";
        if (supabaseErrMsg.includes("already") || supabaseErrMsg.includes("duplicate")) {
          const err = new Error("User with this email already exists");
          (err as any).code = "ACCOUNT_EXISTS";
          (err as any).supabaseOriginal = supabaseError.message; // for internal logging
          throw err;
        }
        // Log the raw error internally for debugging
        logger.error("Supabase user creation failed", { error: supabaseError.message });
        const err = new Error("Account creation failed");
        (err as any).code = "SIGNUP_FAILED";
        (err as any).supabaseOriginal = supabaseError.message; // for internal logging
        throw err;
      }

      if (!supabaseUser.user) {
        throw new Error("Failed to create Supabase user");
      }

      const userId = supabaseUser.user.id;

      // 4. Generate unique referral code
      const referralCode = await this.generateReferralCode(userData.full_name);

      // 5. Create user in our Database with the SAME ID
      const user = await prisma.user.create({
        data: {
          id: userId,
          email,
          full_name: userData.full_name,
          phone_number: userData.phone_number,
          user_type: userData.user_type,
          field_of_study: userData.field_of_study,
          otp_method: userData.otp_method || "email",
          email_verified: false, // Force verification
          survey_completed: false,
          referral_code: referralCode,
        },
      });
      
      // 5.5 Process referral if affiliate_ref was provided.
      //     processReferralReward upgrades BOTH the referee and referrer to
      //     Plus (when on free tier), so it must run BEFORE any fallback
      //     free-subscription creation — otherwise the free row would clobber
      //     the referral reward (bug B2). It returns the outcome so we can
      //     skip creating a free subscription when the referee was upgraded.
      let referralResult = { rewardGranted: false, refereeRewardGranted: false };
      if (userData.affiliate_ref) {
        referralResult = await this.processReferralReward(
          userId,
          userData.affiliate_ref,
          requestContext,
        );
      }

      // 6. Create default free subscription for the user — but ONLY if they
      //    were NOT upgraded to Plus via a successful referral reward. If
      //    refereeRewardGranted is true, a plus subscription already exists.
      if (!referralResult.rewardGranted) {
        const existingSub = await prisma.subscription.findUnique({
          where: { user_id: userId },
        });

        if (!existingSub) {
          await prisma.subscription.create({
            data: {
              user_id: userId,
              plan: "free",
              status: "active",
            },
          });
        }
      }

      // Admin promotion is now controlled exclusively through the admin_users table.
      // Legacy hardcoded email whitelisting removed as privilege escalation fix.

      // 7. Generate and Send OTP
      const otpCode = this.generateOTP();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      await prisma.oTPVerification.create({
        data: {
          user_id: userId,
          email,
          otp_code: otpCode,
          expires_at: expiresAt,
          verified: false,
        },
      });

      // Send OTP email to user
      await EmailService.sendOTPEmail(email, otpCode, userData.full_name || "");

      return {
        success: true,
        user: { id: userId, email },
        message: "Signup successful. Please verify your email.",
        otpSent: true, // Signal to frontend to show OTP screen
        needsVerification: true,
      };
    } catch (error: any) {
      logger.error("Hybrid sign up failed", { error: error.message });

      if (
        error.message.includes("already registered") ||
        error.message.includes("already exists")
      ) {
        return {
          success: false,
          message: "User with this email already exists",
        };
      }

      throw error;
    }
  }

  /**
   * Verify OTP
   */
  static async verifyOTP(
    userId: string | null,
    otp: string,
    email?: string, // Optional fallback search
  ): Promise<{ success: boolean; message: string }> {
    try {
      let user;

      if (userId) {
        user = await prisma.user.findUnique({ where: { id: userId } });
      } else if (email) {
        user = await prisma.user.findUnique({ where: { email } });
      }

      if (!user) {
        return { success: false, message: "User not found" };
      }

      const otpRecord = await prisma.oTPVerification.findFirst({
        where: {
          user_id: user.id,
          otp_code: otp,
          verified: false,
          expires_at: { gt: new Date() },
        },
        orderBy: { created_at: "desc" },
      });

      if (!otpRecord) {
        return { success: false, message: "Invalid or expired OTP" };
      }

      // Mark OTP verified (delete all OTPs for this user to clean up)
      await prisma.oTPVerification.deleteMany({
        where: { user_id: user.id },
      });

      // Mark User verified
      await prisma.user.update({
        where: { id: user.id },
        data: { email_verified: true },
      });

      // Send Welcome Email
      await EmailService.sendWelcomeEmail(user.email, user.full_name || "");

      return { success: true, message: "Email verified successfully" };
    } catch (error: any) {
      logger.error("Verify OTP failed", { error: error.message });
      return { success: false, message: "Verification failed" };
    }
  }

  /**
   * Resend Verification
   */
  static async resendVerification(
    email: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return { success: false, message: "User not found" };
      }

      if (user.email_verified) {
        return { success: false, message: "Email already verified" };
      }

      const otpCode = this.generateOTP();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      await prisma.oTPVerification.create({
        data: {
          user_id: user.id,
          email,
          otp_code: otpCode,
          expires_at: expiresAt,
          verified: false,
        },
      });

      await EmailService.sendOTPEmail(email, otpCode, user.full_name || "");

      return { success: true, message: "Verification code resent" };
    } catch (error: any) {
      logger.error("Resend verification failed", { error: error.message });
      throw error;
    }
  }

  /**
   * Request a password reset — generates a token and sends email via Resend
   */
  static async requestPasswordReset(
    email: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const user = await prisma.user.findUnique({ where: { email } });

      // Always return success to prevent email enumeration
      // (even if user doesn't exist, we don't tell the caller)
      if (!user) {
        logger.info("Password reset requested for non-existent email", {
          email,
        });
        return {
          success: true,
          message: "If an account exists, a password reset email has been sent.",
        };
      }

      // Generate a secure token
      const token = crypto.randomUUID();

      // Token expires in 1 hour
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      // Store the reset token in the database
      await prisma.passwordResetToken.create({
        data: {
          user_id: user.id,
          email: user.email,
          token,
          expires_at: expiresAt,
        },
      });

      // Build the reset link
      const frontendUrl = await SecretsService.getFrontendUrl();
      const resetLink = `${frontendUrl}/reset-password?oobCode=${token}&email=${encodeURIComponent(user.email)}`;

      // Send the password reset email via Resend
      await EmailService.sendPasswordResetEmail(
        user.email,
        resetLink,
        user.full_name || "",
      );

      logger.info("Password reset email sent", {
        email: user.email,
        userId: user.id,
      });

      return {
        success: true,
        message: "If an account exists, a password reset email has been sent.",
      };
    } catch (error: any) {
      logger.error("Password reset request failed", {
        error: error.message,
        email,
      });
      // Still return success to avoid leaking account existence
      return {
        success: true,
        message: "If an account exists, a password reset email has been sent.",
      };
    }
  }

  /**
   * Verify a password reset token is valid
   */
  static async verifyResetToken(
    token: string,
  ): Promise<{ valid: boolean; email?: string; userId?: string; message: string }> {
    try {
      const resetToken = await prisma.passwordResetToken.findUnique({
        where: { token },
      });

      if (!resetToken) {
        return {
          valid: false,
          message: "Reset token not found or invalid.",
        };
      }

      if (resetToken.used) {
        return {
          valid: false,
          message: "This reset link has already been used.",
        };
      }

      if (resetToken.expires_at < new Date()) {
        return {
          valid: false,
          message: "This reset link has expired. Please request a new one.",
        };
      }

      return {
        valid: true,
        email: resetToken.email,
        userId: resetToken.user_id,
        message: "Token is valid.",
      };
    } catch (error: any) {
      logger.error("Token verification failed", {
        error: error.message,
        token: token.substring(0, 8) + "...",
      });
      return {
        valid: false,
        message: "Token verification failed.",
      };
    }
  }

  /**
   * Confirm password reset — verifies token and updates password in Supabase
   */
  static async confirmPasswordReset(
    token: string,
    newPassword: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // 1. Verify the token
      const verification = await this.verifyResetToken(token);
      if (!verification.valid) {
        return {
          success: false,
          message: verification.message,
        };
      }

      const supabaseAdmin = await getSupabaseAdminClient();
      if (!supabaseAdmin) {
        throw new Error("Supabase admin client not available");
      }

      // 2. Update the password in Supabase Auth
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        verification.userId!,
        { password: newPassword },
      );

      if (updateError) {
        logger.error("Supabase password update failed", {
          error: updateError.message,
          userId: verification.userId,
        });
        throw new Error(updateError.message);
      }

      // 3. Mark the token as used so it can't be reused
      await prisma.passwordResetToken.update({
        where: { token },
        data: { used: true },
      });

      // 4. Log the password change for security audit
      await SecurityLogService.logEvent({
        user_id: verification.userId!,
        event_type: "password_change",
        description: "Password changed via reset link",
        status: "success",
        metadata: { method: "reset_link" },
      });

      logger.info("Password reset confirmed", {
        userId: verification.userId,
      });

      return {
        success: true,
        message: "Password updated successfully.",
      };
    } catch (error: any) {
      logger.error("Password reset confirmation failed", {
        error: error.message,
        token: token.substring(0, 8) + "...",
      });
      return {
        success: false,
        message: "Failed to update password. Please try again.",
      };
    }
  }

  /**
   * Update User Profile
   */
  static async updateUserProfile(
    idToken: string,
    updates: any,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const supabaseAdmin = await getSupabaseAdminClient();
      if (!supabaseAdmin) {
        throw new Error("Supabase admin client not available");
      }

      // Verify token
      const {
        data: { user },
        error,
      } = await supabaseAdmin.auth.getUser(idToken);

      if (error || !user) {
        return { success: false, error: "Unauthorized" };
      }

      // Update in Prisma
      await prisma.user.update({
        where: { id: user.id },
        data: {
          full_name: updates.full_name,
          phone_number: updates.phone_number,
          user_type: updates.user_type,
          field_of_study: updates.field_of_study,
          // Add other fields as necessary
        },
      });

      return { success: true };
    } catch (error: any) {
      logger.error("Update profile failed", { error: error.message });
      return { success: false, error: "Operation failed" };
    }
  }

  /**
   * Promote user to admin if they are in the whitelist
   * NOTE: This method is intentionally removed - admin promotion should only
   * happen through explicit admin records in the admin_users table.
   * Legacy hardcoded email whitelisting was a privilege escalation vulnerability.
   */
  private static async promoteAdminIfEligible(email: string, userId: string): Promise<void> {
    // Admin access is now controlled exclusively through the admin_users table.
    // No email-based fallback or hardcoded whitelisting.
    logger.warn(`Admin promotion attempt for ${email} - privilege escalation prevention enabled`);
  }

  static async recordLogin(userId: string, ipAddress: string, userAgent: string) {
    try {
      let formattedIp = formatIpAddress(ipAddress, "");

      // If the proxy headers gave us nothing usable (or we're running behind
      // a local tunnel), fall back to this server's public IP so the security
      // log and the alert email always carry a real address.
      if (!formattedIp || isLoopbackAddress(formattedIp)) {
        const publicIp = await getPublicIp();
        if (publicIp) formattedIp = publicIp;
      }

      const location = await getLocationFromIp(formattedIp);
      const browserInfo = detectBrowser(userAgent);
      const deviceInfo = detectDeviceType(userAgent);

      await prisma.userSession.updateMany({
        where: { user_id: userId, is_current: true },
        data: { is_current: false },
      });

      await prisma.userSession.create({
        data: {
          user_id: userId,
          session_id: crypto.randomUUID(),
          device_info: userAgent,
          browser: browserInfo.browser,
          device_type: deviceInfo.deviceType,
          ip_address: formattedIp,
          location,
          last_active: new Date(),
          is_current: true,
        },
      });

      await SecurityService.recordLoginAttempt(
        userId,
        formattedIp,
        userAgent,
        location || "Unknown",
        "success",
      );
    } catch (error: any) {
      logger.error("Failed to record login", { error: error.message, userId });
    }
  }
}
