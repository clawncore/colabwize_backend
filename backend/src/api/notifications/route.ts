import {
  getUserNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "../../services/notificationService";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
}

// GET /api/notifications - Get user notifications
export async function GET(request: Request & { user?: { id: string } }) {
  try {
    // Get user from authentication middleware (attached by main-server.ts)
    const userId = request.user?.id;

    if (!userId) {
      return new Response(
        JSON.stringify({ success: false, message: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get query parameters
    const url = new URL(request.url, "http://localhost");
    const limit = parseInt(url.searchParams.get("limit") || "20");
    const offset = parseInt(url.searchParams.get("offset") || "0");
    const type = url.searchParams.get("type") || undefined;
    const priority = url.searchParams.get("priority") as
      | "high"
      | "medium"
      | "low"
      | undefined;
    const search = url.searchParams.get("search") || undefined;
    const read = url.searchParams.get("read");
    const readFilter = read !== null ? read === "true" : undefined;
    const workspaceId = url.searchParams.get("workspaceId") || undefined;

    // Build filters object
    const filters = {
      type,
      priority,
      search,
      read: readFilter,
      workspaceId,
    };

    // Remove undefined values from filters
    Object.keys(filters).forEach(
      (key) =>
        filters[key as keyof typeof filters] === undefined &&
        delete filters[key as keyof typeof filters]
    );

    // Get notifications
    const notifications = await getUserNotifications(
      userId,
      limit,
      offset,
      filters
    );

    // Get unread count
    const unreadCount = await getUnreadNotificationCount(userId, {
      workspaceId,
    });

    return new Response(
      JSON.stringify({ success: true, notifications, unreadCount }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "Failed to fetch notifications",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// POST /api/notifications - Create notification or mark as read
export async function POST(request: Request & { user?: { id: string } }) {
  try {
    // Get user from authentication middleware (attached by main-server.ts)
    const userId = request.user?.id;

    if (!userId) {
      return new Response(
        JSON.stringify({ success: false, message: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    let body = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch (parseError) {
      // If JSON parsing fails, use an empty object
      console.warn("Failed to parse request body as JSON, using empty object");
    }

    const {
      notificationId,
      markAllAsRead,
      type,
      title,
      message,
      data,
      recipientId,
    } = body as {
      notificationId?: string;
      markAllAsRead?: boolean;
      type?: string;
      title?: string;
      message?: string;
      data?: any;
      recipientId?: string;
    };

    // If title and message are provided, we're creating a notification
    if (title && message) {
      const targetUserId = recipientId || userId;

      const {
        createNotification,
      } = require("../../services/notificationService");

      const notification = await createNotification(
        targetUserId,
        (type as any) || "document_change",
        title,
        message,
        data
      );

      return new Response(
        JSON.stringify({
          success: true,
          message: "Notification created",
          notification,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }

    // Otherwise, handle marking as read (existing logic)
    if (markAllAsRead === true) {
      // Mark all notifications as read
      await markAllNotificationsAsRead(userId);
      return new Response(
        JSON.stringify({
          success: true,
          message: "All notifications marked as read",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } else if (notificationId) {
      // Mark specific notification as read
      await markNotificationAsRead(notificationId);
      return new Response(
        JSON.stringify({
          success: true,
          message: "Notification marked as read",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Invalid request parameters",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error in notification POST handler:", error);
    return new Response(
        JSON.stringify({
          success: false,
          message: "Failed to process notification request",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
  }
}
