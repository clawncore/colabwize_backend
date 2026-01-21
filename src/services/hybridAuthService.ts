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
