
import { getSupabaseClient } from "../../../lib/supabase/client";
import { prisma } from "../../../lib/prisma";
import { ExportService } from "../../../services/exportService";
import logger from "../../../monitoring/logger";
import { getSafeString } from "../../../utils/requestHelpers";

// Export user data
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

    let user;

    // STRATEGY: Remote Verification via Supabase Admin
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    user = data.user;

    // Parse request body
    const body = await request.json() as any;
    const format = getSafeString(body.format);
    const include = body.include || {};

    // Log the export request
    logger.info("User data export request received", {
      userId: user.id,
      format,
      include,
    });

    // Get user data based on include options
    const userData: any = {
      exportedAt: new Date().toISOString(),
    };

    if (include.projects !== false) {
      userData.projects = await prisma.project.findMany({
        where: { user_id: user.id },
        include: {
          citations: true,
          exports: true,
          files: true,
          originality_scans: true,
          chat_sessions: true,
          certificates: true,
          analytics_events: true,
          authorship_activities: true,
          real_time_activities: true,
        },
      });
    }

    if (include.citations !== false) {
      userData.citations = await prisma.citation.findMany({
        where: { project: { user_id: user.id } },
      });
    }





    if (include.deletedItems !== false) {
      userData.deletedItems = await prisma.recycledItem.findMany({
        where: { user_id: user.id },
      });
    }

    // Get user profile
    userData.user = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        full_name: true,
        created_at: true,
        institution: true,
        location: true,
        bio: true,
      },
    });

    // Fetch user files if not explicitly excluded
    if (include.files !== false) {
      userData.files = await prisma.file.findMany({
        where: { user_id: user.id },
      });
    }

    // Fetch user certificates if not explicitly excluded
    if (include.certificates !== false) {
      userData.certificates = await prisma.certificate.findMany({
        where: { user_id: user.id },
      });
    }

    // Handle different export formats
    if (format && format !== "json") {
      // Use ExportService to handle specific format exports
      try {
        let result;
        switch (format) {

          case "zip":
            // Create a ZIP archive of user data
            const zipBuffer = await ExportService.createZipArchive(userData);

            return new Response(zipBuffer as any, {
              // Type assertion to allow Buffer for Response
              status: 200,
              headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename=user-data-${user.id}.zip`,
              },
            });

          default:
            return new Response(
              JSON.stringify({
                error: `Unsupported export format: ${format}`,
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            );
        }
      } catch (exportError: any) {
        logger.error("Error in format-specific export:", exportError);
        return new Response(
          JSON.stringify({
            error: `Failed to export in ${format} format: ${exportError.message}`,
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    } else {
      // Default to JSON format
      return new Response(
        JSON.stringify({
          success: true,
          data: userData,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }
  } catch (error) {
    console.error("Error exporting user data:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
