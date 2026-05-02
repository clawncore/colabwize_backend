import { prisma } from "../lib/prisma";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { EmailService } from "./emailService";
import logger from "../monitoring/logger";
import { SecretsService } from "./secrets-service";
import { EntitlementService } from "./EntitlementService";
import { clearSubscriptionCache } from "../api/subscription";
import { SubscriptionService } from "./subscriptionService";

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
      await this.promoteAdminIfEligible(data.email, data.id);

      // Create default free subscription
      await prisma.subscription.create({
        data: {
          user_id: data.id,
          plan: "free",
          status: "active",
        },
      });

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

        // Check for admin promotion during sync
        await this.promoteAdminIfEligible(email, supabaseUser.id);

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
   * Process referral reward when a new user signs up with a referral code
   */
  private static async processReferralReward(refereeId: string, referralCode: string): Promise<void> {
    try {
      // 1. Find referrer by code
      const referrer = await prisma.user.findUnique({
        where: { referral_code: referralCode },
      });
      
      if (!referrer) {
        logger.warn("Referral code not found", { referralCode });
        return;
      }
      
      // 2. Prevent self-referral
      if (referrer.id === refereeId) {
        logger.warn("Self-referral attempt blocked", { userId: refereeId });
        return;
      }
      
      // 3. Check if referee already used a referral code
      const existingReferral = await prisma.referral.findUnique({
        where: { referee_id: refereeId },
      });
      
      if (existingReferral) {
        logger.warn("Referee already used a referral code", { refereeId });
        return;
      }
      
      // 4. Create referral record
      const rewardExpiresAt = new Date();
      rewardExpiresAt.setDate(rewardExpiresAt.getDate() + 5); // 5 days of Plus
      
      await prisma.referral.create({
        data: {
          referrer_id: referrer.id,
          referee_id: refereeId,
          reward_status: "granted",
          reward_expires_at: rewardExpiresAt,
        },
      });
      
      // 5. Upgrade referrer to Plus for 5 days (if on free plan)
      const referrerSub = await prisma.subscription.findUnique({
        where: { user_id: referrer.id },
      });
      
      // Use getActivePlan to check the EFFECTIVE plan (handles expired subscriptions)
      const effectivePlan = await SubscriptionService.getActivePlan(referrer.id, referrerSub);
      
      if (effectivePlan === "free" || !referrerSub) {
        // If no subscription exists, create one
        if (!referrerSub) {
          await prisma.subscription.create({
            data: {
              user_id: referrer.id,
              plan: "plus",
              status: "active",
              entitlement_expires_at: rewardExpiresAt,
            },
          });
        } else {
          // Update existing subscription to plus with expiry
          await prisma.subscription.update({
            where: { user_id: referrer.id },
            data: {
              plan: "plus",
              status: "active",
              entitlement_expires_at: rewardExpiresAt,
            },
          });
        }
        
        // Rebuild entitlements so user gets plus features immediately
        await EntitlementService.rebuildEntitlements(referrer.id);
        
        // Clear subscription cache so the user sees updated plan immediately
        clearSubscriptionCache(referrer.id);
        
        // Send reward email
        await EmailService.sendReferralRewardEmail(referrer.email, referrer.full_name || "", 5);
        
        logger.info("Referral reward granted", {
          referrerId: referrer.id,
          refereeId,
          expiresAt: rewardExpiresAt,
          previousEffectivePlan: effectivePlan,
        });
      } else {
        logger.info("Referrer already on paid plan, referral logged without upgrade", {
          referrerId: referrer.id,
          effectivePlan: effectivePlan,
          rawPlan: referrerSub?.plan,
        });
      }
    } catch (error: any) {
      logger.error("Failed to process referral reward", { error: error.message, refereeId, referralCode });
      // Don't throw - referral failure shouldn't block signup
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
        throw new Error(`Supabase creation failed: ${supabaseError.message}`);
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
      
      // 5.5 Process referral if affiliate_ref was provided
      if (userData.affiliate_ref) {
        await this.processReferralReward(userId, userData.affiliate_ref);
      }

      // 6. Create default free subscription for the user (unless they were upgraded via referral)
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

      // 6.5 Check for admin promotion
      await this.promoteAdminIfEligible(email, userId);

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
      return { success: false, error: error.message };
    }
  }

  /**
   * Promote user to admin if they are in the whitelist
   */
  private static async promoteAdminIfEligible(email: string, userId: string): Promise<void> {
    const ADMIN_EMAILS = ["simbisai@colabwize.com", "craig@gmail.com"];
    
    if (ADMIN_EMAILS.includes(email.toLowerCase())) {
      try {
        const supabaseAdmin = await getSupabaseAdminClient();
        if (!supabaseAdmin) return;

        logger.info(`Promoting ${email} to admin role`, { userId });
        
        const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
          app_metadata: { role: "admin" }
        });

        if (error) {
          logger.error(`Failed to promote ${email} to admin`, { error: error.message });
        } else {
          logger.info(`Successfully promoted ${email} to admin`);
        }
      } catch (error) {
        logger.error(`Error during admin promotion for ${email}`, { error });
      }
    }
  }
}
