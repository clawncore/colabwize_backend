import { prisma } from "../lib/prisma";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { EmailService } from "./emailService";
import logger from "../monitoring/logger";
import { SecretsService } from "./secrets-service";

/**
 * Service for Hybrid Authentication (Supabase + Custom Backend)
 */
export class HybridAuthService {
  /**
   * Generate a 6-digit OTP code
   */
  private static generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
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
    }
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

      // 2. Create user in Supabase Auth
      const supabaseAdmin = await getSupabaseAdminClient();
      if (!supabaseAdmin) {
        throw new Error("Supabase admin client not available");
      }

      // We auto-confirm in Supabase because we handle verification ourselves via OTP
      // or we want them to be able to sign in, but blocked by our backend check
      // However, usually we want email_confirm: true so they can technically sign in to Supabase,
      // but our frontend checks our own DB for verification status.
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

      // 3. Create user in our Database with the SAME ID
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
        },
      });

      // 4. Create default free subscription for the user
      await prisma.subscription.create({
        data: {
          user_id: userId,
          plan: "free",
          status: "active",
        },
      });

      // 5. Generate and Send OTP
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
      // If user was created in Supabase but DB failed, we might have an inconsistency
      // But for now let's just error out.

      // If user already exists in Supabase (but not in our DB, which shouldn't happen if they are synced),
      // we might want to handle that.
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

      // Create user
      const user = await prisma.user.create({
        data: {
          id: data.id,
          email: data.email,
          full_name: data.fullName,
          email_verified: true, // OAuth is verified
          survey_completed: false,
        },
      });

      // Create default free subscription
      await prisma.subscription.create({
        data: {
          user_id: data.id,
          plan: "free",
          status: "active",
        },
      });

      // Send welcome email?
      // await EmailService.sendWelcomeEmail(data.email, data.fullName);

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
   * Verify OTP
   */
  static async verifyOTP(
    userId: string | null,
    otp: string,
    email?: string // Optional fallback search
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

      // Mark OTP verified (delete it)
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
    email: string
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
   * Sync User Session (Signin)
   * Verifies the Supabase ID token and ensures user exists in our database
   */
  static async syncUserSession(
    idToken: string
  ): Promise<{ success: boolean; error?: string; user?: any }> {
    try {
      const supabaseAdmin = await getSupabaseAdminClient();
      if (!supabaseAdmin) {
        throw new Error("Supabase admin client not available");
      }

      // Verify the token by getting the user
      const {
        data: { user: supabaseUser },
        error,
      } = await supabaseAdmin.auth.getUser(idToken);

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

        // Create user in our DB
        const newUser = await prisma.user.create({
          data: {
            id: supabaseUser.id,
            email: email,
            full_name: metadata.full_name || metadata.name || "",
            email_verified: !!supabaseUser.email_confirmed_at, // Trust Supabase verification status
            survey_completed: false, // Default to false if just syncing
            otp_method: "email",
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
   * Update User Profile
   */
  static async updateUserProfile(
    idToken: string,
    updates: any
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
}
