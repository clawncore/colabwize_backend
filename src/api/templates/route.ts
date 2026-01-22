import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const type = url.pathname.split("/").pop(); // Get the type from the URL path like /api/templates/type/research-paper
    const userId = url.searchParams.get("userId");
    const isPublic = url.searchParams.get("isPublic");

    let whereClause: any = {};

    // If a type is provided, filter by type
    if (type && type !== "type" && type !== "templates") {
      whereClause.type = type;
    }

    // If userId is provided, get user-specific templates
    if (userId) {
      whereClause.user_id = userId;
    } else if (isPublic !== "false") {
      // Default to public templates if not getting user-specific ones
      whereClause.is_public = true;
    }

    const templates = await prisma.documentTemplate.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        content: true,
        citation_style: true,
        is_public: true,
        created_at: true,
        updated_at: true,
        rating: true,
        downloads: true,
        author_name: true,
      },
    });

    return new Response(JSON.stringify({ success: true, templates }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    logger.error("Error fetching templates:", error);
    return new Response(
      JSON.stringify({ success: false, message: "Failed to fetch templates" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export async function POST(request: Request) {
  try {
    const data = (await request.json()) as any;
    const {
      name,
      description,
      type,
      content,
      is_public,
      user_id,
      citation_style,
    } = data;

    const template = await prisma.documentTemplate.create({
      data: {
        name,
        description: description || null,
        type,
        content,
        is_public: is_public || false,
        user_id: user_id || null,
        citation_style: citation_style || null,
      },
    });

    return new Response(JSON.stringify({ success: true, template }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    logger.error("Error creating template:", error);
    return new Response(
      JSON.stringify({ success: false, message: "Failed to create template" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const data = (await request.json()) as any;
    const { id, name, description, type, content, is_public, citation_style } =
      data;

    const template = await prisma.documentTemplate.update({
      where: { id },
      data: {
        name,
        description: description || null,
        type,
        content,
        is_public,
        citation_style: citation_style || null,
        updated_at: new Date(),
      },
    });

    return new Response(JSON.stringify({ success: true, template }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    logger.error("Error updating template:", error);
    return new Response(
      JSON.stringify({ success: false, message: "Failed to update template" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Template ID is required",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    await prisma.documentTemplate.delete({
      where: { id },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Template deleted successfully",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    logger.error("Error deleting template:", error);
    return new Response(
      JSON.stringify({ success: false, message: "Failed to delete template" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
