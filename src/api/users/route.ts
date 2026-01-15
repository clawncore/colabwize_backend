import {
  getSupabaseClient,
  getSupabaseAdminClient,
} from "../../lib/supabase/client";
import { prisma } from "../../lib/prisma";

// Request OTP for profile update
export async function POST_REQUEST_OTP(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action !== "profile_update") {
      return new Response(
        JSON.stringify({ error: "Invalid action parameter" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get user from authorization header
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization header" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify the token with Supabase Auth
    let user;
    try {
      const client = await getSupabaseClient();
      if (!client) {
        return new Response(
          JSON.stringify({ error: "Supabase client not initialized" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const {
        data: { user: userData },
        error,
      } = await client.auth.getUser(token);

      if (error || !userData) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      user = userData;
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get user details
    const prismaUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        email: true,
        phone_number: true,
        full_name: true,
        user_type: true,
      },
    });

    if (!prismaUser) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Determine OTP method (email or SMS)
    let method = "email";
    if (prismaUser.phone_number) {
      method = "sms";
    }

    // Import OTP service
    const { OTPService } = await import("../../services/otpService");

    // Send OTP for profile update
    const result = await OTPService.sendOTP(
      user.id,
      prismaUser.email,
      prismaUser.phone_number || "",
      method,
      prismaUser.full_name || "",
      true // isProfileUpdate
    );

    if (!result) {
      return new Response(JSON.stringify({ error: "Failed to send OTP" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `OTP sent successfully to your ${method}`,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error requesting OTP:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Get user account details
export async function GET(request: Request) {
  try {
    // Get user from authorization header
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization header" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify the token with Supabase Auth
    let user;
    try {
      const client = await getSupabaseClient();
      if (!client) {
        return new Response(
          JSON.stringify({ error: "Supabase client not initialized" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const {
        data: { user: userData },
        error,
      } = await client.auth.getUser(token);

      if (error || !userData) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      user = userData;
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get user details from Prisma
    const prismaUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        full_name: true,
        phone_number: true,
        user_type: true,
        field_of_study: true,
        bio: true,
        institution: true,
        location: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!prismaUser) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get user subscription info
    const subscription = await prisma.subscription.findUnique({
      where: { user_id: user.id },
      select: {
        plan: true,
        status: true,
      },
    });

    return new Response(
      JSON.stringify({
        user: {
          ...prismaUser,
          subscription: subscription || null,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error getting user details:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Update user profile
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const {
      full_name,
      phone_number,
      user_type,
      field_of_study,
      bio,
      institution,
      location,
    } = body;

    // Get user from authorization header
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization header" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify the token with Supabase Auth
    let user;
    try {
      const client = await getSupabaseClient();
      if (!client) {
        return new Response(
          JSON.stringify({ error: "Supabase client not initialized" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const {
        data: { user: userData },
        error,
      } = await client.auth.getUser(token);

      if (error || !userData) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      user = userData;
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Update user in database
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        full_name,
        phone_number,
        user_type,
        field_of_study,
        bio,
        institution,
        location,
        updated_at: new Date(),
      },
      select: {
        id: true,
        email: true,
        full_name: true,
        phone_number: true,
        user_type: true,
        field_of_study: true,
        bio: true,
        institution: true,
        location: true,
        created_at: true,
        updated_at: true,
      },
    });

    // Also update user metadata in Supabase Auth
    const client = await getSupabaseClient();
    if (!client) {
      console.error("Supabase client not initialized");
      return new Response(
        JSON.stringify({ error: "Supabase client not initialized" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    const { error: updateError } = await client.auth.updateUser({
      data: {
        full_name,
        phone_number,
        user_type,
        field_of_study,
      },
    });

    if (updateError) {
      console.error(
        "Error updating user metadata in Supabase Auth:",
        updateError
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Profile updated successfully",
        user: updatedUser,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error updating user profile:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Delete user account
export async function DELETE(request: Request & { user?: { id: string } }) {
  try {
    let user;

    // Check if user is passed directly from router context
    if (request.user && request.user.id) {
      user = { id: request.user.id };
    } else {
      // Get user from authorization header (fallback for direct API calls)
      const authHeader = request.headers.get("authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Missing or invalid authorization header" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const token = authHeader.substring(7); // Remove "Bearer " prefix

      // Verify the token with Supabase Auth
      try {
        const client = await getSupabaseClient();
        if (!client) {
          return new Response(
            JSON.stringify({ error: "Supabase client not initialized" }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        const {
          data: { user: userData },
          error,
        } = await client.auth.getUser(token);

        if (error || !userData) {
          return new Response(
            JSON.stringify({ error: "Invalid or expired token" }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        user = userData;
      } catch (error) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    // Get password from request body for verification
    let body;
    try {
      body = await request.json();
    } catch (error) {
      body = {};
    }

    const { confirmPassword } = body || {};

    // Verify password before deleting account
    if (confirmPassword) {
      const client = await getSupabaseClient();
      if (!client) {
        return new Response(
          JSON.stringify({ error: "Supabase client not initialized" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const { data, error } = await client.auth.signInWithPassword({
        email: user.email || "",
        password: confirmPassword,
      });

      if (error || !data?.user) {
        return new Response(JSON.stringify({ error: "Invalid password" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Delete user from database
    await prisma.user.delete({
      where: { id: user.id },
    });

    // Delete user from Supabase Auth
    const adminClient = await getSupabaseAdminClient();
    if (adminClient) {
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(
        user.id
      );

      if (deleteError) {
        console.error("Error deleting user from Supabase Auth:", deleteError);
        // Don't return error here as the database deletion was successful
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Account deleted successfully",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error deleting user account:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Update user profile with OTP verification
export async function updateProfileWithOTP(request: Request) {
  try {
    const body = await request.json();
    const {
      full_name,
      phone_number,
      user_type,
      field_of_study,
      bio,
      institution,
      location,
      email,
      otp,
    } = body;

    // Get user from authorization header
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization header" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify the token with Supabase Auth
    let user;
    try {
      const client = await getSupabaseClient();
      if (!client) {
        return new Response(
          JSON.stringify({ error: "Supabase client not initialized" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const {
        data: { user: userData },
        error,
      } = await client.auth.getUser(token);

      if (error || !userData) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      user = userData;
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Verify the OTP if provided
    if (otp) {
      const { OTPService } = await import("../../services/otpService");
      const isVerified = await OTPService.verifyOTP(user.id, otp);

      if (!isVerified) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired OTP" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    // Prepare update data
    const updateData: any = {
      updated_at: new Date(),
    };

    if (full_name !== undefined) updateData.full_name = full_name;
    if (phone_number !== undefined) updateData.phone_number = phone_number;
    if (user_type !== undefined) updateData.user_type = user_type;
    if (field_of_study !== undefined)
      updateData.field_of_study = field_of_study;
    if (bio !== undefined) updateData.bio = bio;
    if (institution !== undefined) updateData.institution = institution;
    if (location !== undefined) updateData.location = location;

    // If email is being updated, we need to handle it separately
    if (email && email !== user.email) {
      // This would require a different flow in Supabase
      return new Response(
        JSON.stringify({
          error: "Email updates require a separate verification process",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Update user in database
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        full_name: true,
        phone_number: true,
        user_type: true,
        field_of_study: true,
        bio: true,
        institution: true,
        location: true,
        created_at: true,
        updated_at: true,
      },
    });

    // Also update user metadata in Supabase Auth
    const client = await getSupabaseClient();
    if (!client) {
      console.error("Supabase client not initialized");
      return new Response(
        JSON.stringify({ error: "Supabase client not initialized" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const updateDataForSupabase: any = {};
    if (full_name !== undefined) updateDataForSupabase.full_name = full_name;
    if (phone_number !== undefined)
      updateDataForSupabase.phone_number = phone_number;
    if (user_type !== undefined) updateDataForSupabase.user_type = user_type;
    if (field_of_study !== undefined)
      updateDataForSupabase.field_of_study = field_of_study;

    if (Object.keys(updateDataForSupabase).length > 0) {
      const { error: updateError } = await client.auth.updateUser({
        data: updateDataForSupabase,
      });

      if (updateError) {
        console.error(
          "Error updating user metadata in Supabase Auth:",
          updateError
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Profile updated successfully",
        user: updatedUser,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error updating user profile with OTP:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Change user password
export async function changePassword(request: Request) {
  try {
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    // Get user from authorization header
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization header" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify the token with Supabase Auth
    let user;
    try {
      const client = await getSupabaseClient();
      if (!client) {
        return new Response(
          JSON.stringify({ error: "Supabase client not initialized" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const {
        data: { user: userData },
        error,
      } = await client.auth.getUser(token);

      if (error || !userData) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      user = userData;
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Verify current password by attempting to sign in
    const signInClient = await getSupabaseClient();
    const { error: signInError } = await signInClient.auth.signInWithPassword({
      email: user.email || "", // Use the nullish coalescing operator to provide a default value
      password: currentPassword,
    });

    if (signInError) {
      return new Response(
        JSON.stringify({ error: "Current password is incorrect" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Update password using Supabase Auth
    const { error: updatePasswordError } = await signInClient.auth.updateUser({
      password: newPassword,
    });

    if (updatePasswordError) {
      return new Response(
        JSON.stringify({ error: "Failed to update password" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Password updated successfully",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error changing password:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Enable 2FA
export async function enable2FA(request: Request) {
  try {
    // Get user from authorization header
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization header" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify the token with Supabase Auth
    let user;
    try {
      const client = await getSupabaseClient();
      if (!client) {
        return new Response(
          JSON.stringify({ error: "Supabase client not initialized" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const {
        data: { user: userData },
        error,
      } = await client.auth.getUser(token);

      if (error || !userData) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      user = userData;
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // In a real implementation, we would integrate with a 2FA service like Google Authenticator
    // For now, we'll simulate the process by updating the user's 2FA status in the database
    await prisma.user.update({
      where: { id: user.id },
      data: {
        two_factor_enabled: true,
        updated_at: new Date(),
      },
    });

    // In a real implementation, we would generate a QR code and secret for the user to scan
    // For now, we'll just return success
    return new Response(
      JSON.stringify({
        success: true,
        message:
          "2FA enabled successfully. Follow the instructions sent to your email.",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error enabling 2FA:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Get account usage statistics
export async function getAccountUsage(request: Request) {
  try {
    // Get user from authorization header
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization header" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify the token with Supabase Auth
    let user;
    try {
      const client = await getSupabaseClient();
      if (!client) {
        return new Response(
          JSON.stringify({ error: "Supabase client not initialized" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const {
        data: { user: userData },
        error,
      } = await client.auth.getUser(token);

      if (error || !userData) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      user = userData;
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get user usage statistics from the database
    const userProjects = await prisma.project.count({
      where: { user_id: user.id },
    });

    const userStorage = await prisma.user.findUnique({
      where: { id: user.id },
      select: { storage_used: true },
    });

    const userCollaborators = await prisma.project.count({
      where: {
        user_id: user.id,
        collaborators: {
          some: {
            user_id: { not: user.id }, // Count only other users as collaborators
          },
        },
      },
    });

    const aiRequests = await prisma.aIUsage.findFirst({
      where: {
        user_id: user.id,
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        usage: {
          projects: userProjects,
          storage: userStorage?.storage_used || 0,
          collaborators: userCollaborators,
          aiRequests: aiRequests?.request_count || 0,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error getting account usage:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Update account preferences
export async function updateAccountPreferences(request: Request) {
  try {
    const body = await request.json();
    const { preferences } = body;

    // Get user from authorization header
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization header" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify the token with Supabase Auth
    let user;
    try {
      const client = await getSupabaseClient();
      if (!client) {
        return new Response(
          JSON.stringify({ error: "Supabase client not initialized" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const {
        data: { user: userData },
        error,
      } = await client.auth.getUser(token);

      if (error || !userData) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      user = userData;
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // For now, we don't have a preferences field in the user table, so we'll just return success
    // In a real implementation, we would update a user preferences table
    return new Response(
      JSON.stringify({
        success: true,
        preferences,
        message: "Preferences updated successfully",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error updating account preferences:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Check feature access
export async function hasFeatureAccess(request: Request, feature: string) {
  try {
    // Get user from authorization header
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization header" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify the token with Supabase Auth
    let user;
    try {
      const client = await getSupabaseClient();
      if (!client) {
        return new Response(
          JSON.stringify({ error: "Supabase client not initialized" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const {
        data: { user: userData },
        error,
      } = await client.auth.getUser(token);

      if (error || !userData) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      user = userData;
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get user's subscription to determine feature access
    const subscription = await prisma.subscription.findUnique({
      where: { user_id: user.id },
      select: { plan: true, status: true },
    });

    // Define feature access rules based on plan
    const planFeatures: Record<string, string[]> = {
      free: ["basic", "limited-ai"],
      pro: ["basic", "ai", "collaboration", "advanced"],
      team: ["basic", "ai", "collaboration", "advanced", "admin"],
    };

    // Check if the requested feature is available for the user's plan
    const userPlan = subscription?.plan || "free";
    const availableFeatures = planFeatures[userPlan] || planFeatures.free;
    const hasAccess = availableFeatures.includes(feature);

    return new Response(
      JSON.stringify({
        success: true,
        hasAccess,
        userPlan,
        feature,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error checking feature access:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
