import { getSupabaseClient } from "../../lib/supabase/client";
import { prisma } from "../../lib/prisma";
import { SupabaseStorageService } from "../../services/supabaseStorageService";
import logger from "../../monitoring/logger";

// Upload avatar
export async function POST(request: Request) {
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

    // Parse the form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return new Response(
        JSON.stringify({
          error: "Invalid file type. Only JPEG, PNG, and GIF are allowed.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return new Response(
        JSON.stringify({
          error: "File size too large. Maximum size is 5MB.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Convert file to buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    try {
      // Upload file to Supabase storage
      const uploadResult = await SupabaseStorageService.uploadFile(
        buffer,
        file.name,
        file.type,
        user.id,
        {
          userId: user.id,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          createdAt: new Date(),
        }
      );

      // Update user's avatar URL in the database
      await prisma.user.update({
        where: { id: user.id },
        data: {
          avatar_url: uploadResult.publicUrl,
          updated_at: new Date(),
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          fileUrl: uploadResult.publicUrl,
          message: "Avatar uploaded successfully",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (uploadError: any) {
      logger.error("Avatar upload error", {
        error: uploadError.message,
        userId: user.id,
      });

      return new Response(
        JSON.stringify({
          error: "Failed to upload avatar: " + uploadError.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    console.error("Error uploading avatar:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
