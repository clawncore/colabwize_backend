import {
  createNotification,
  NotificationType,
} from "../../../services/notificationService";

interface TestNotificationBody {
  type: string;
  title: string;
  message: string;
}

// POST /api/notifications/test - Send a test notification
export async function POST(request: Request & { user?: { id: string } }) {
  try {
    // Get user from authentication middleware
    const userId = request.user?.id;

    if (!userId) {
      return new Response(
        JSON.stringify({ success: false, message: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    const body = await request.json();
    const { type, title, message } = body as TestNotificationBody;

    // Validate the notification type
    const validNotificationTypes: NotificationType[] = [
      "comment",
      "mention",
      "document_change",
      "document_shared",
      "new_collaborator",
      "permission_change",
      "comment_resolved",
      "real_time_edit",
      "plagiarism_complete",
      "ai_limit",
      "new_feature",
      "weekly_summary",
      "payment_success",
      "payment_failed",
      "subscription_renewed",
      "subscription_expiring",
      "security_alert",
      "new_feature_announcement",
      "product_tip",
      "newsletter",
      "special_offer",
      "document_deadline",
      "writing_streak",
      "goal_achieved",
      "ai_suggestion",
      "citation_reminder",
      "backup_available",
      "collaborator_request",
      "document_version",
      "research_update",
      "template_update",
      "template_created",
      "template_updated",
      "template_deleted",
      "template_used",
      "template_shared",
      "template_downloaded",
      "template_reviewed",
      "template_review_updated",
      "template_review_deleted",
      "template_shared_with_you",
      "template_share_updated",
      "template_share_removed",
      "template_share_removed_for_you",
      "template_versioned",
      "template_restored",
      "template_version_deleted",
      "template_featured",
      "template_categorized",
      "template_uncategorized",
      "template_exported",
      "template_imported",
      "template_batch_exported",
      "template_batch_imported",
      "template_preview_generated",
      "template_preview_updated",
      "template_preview_deleted",
      "collaboration_invite",
      "collaboration_invite_accepted",
      "collaboration_invite_declined",
      "collaboration_removed",
      "collaboration_session_started",
      "collaboration_session_ended",
      "editor_activity",
      "comment_added",
      "document_exported",
      "xp_earned",
      "subscription_created",
      "subscription_updated",
      "subscription_cancelled",
      "subscription_resumed",
      "subscription_expired",
      "payment_refunded",
      "invoice_available",
      "task_overdue",
      "task_due_soon",
      "task_assigned",
    ];

    if (!validNotificationTypes.includes(type as NotificationType)) {
      return new Response(
        JSON.stringify({
          success: false,
          message: `Invalid notification type. Valid types are: ${validNotificationTypes.join(", ")}`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create test notification
    const notification = await createNotification(
      userId,
      type as NotificationType,
      title,
      message
    );

    return new Response(JSON.stringify({ success: true, notification }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error sending test notification:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "Failed to send test notification",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
