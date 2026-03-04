const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const notifications = await prisma.notification.findMany({
    orderBy: { created_at: "desc" },
    take: 10,
  });
  console.log("All recent notifications:");
  console.log(
    JSON.stringify(
      notifications.map((n) => ({ id: n.id, type: n.type, title: n.title })),
      null,
      2,
    ),
  );

  // The actual query
  const highPriorityTypes = [
    "security_alert",
    "payment_failed",
    "subscription_expiring",
    "subscription_expired",
    "subscription_cancelled",
  ];
  const mediumPriorityTypes = [
    "comment",
    "mention",
    "document_change",
    "document_shared",
    "new_collaborator",
    "permission_change",
    "collaborator_request",
    "collaboration_invite",
    "collaboration_invite_accepted",
    "collaboration_invite_declined",
    "collaboration_removed",
    "comment_resolved",
    "comment_added",
    "real_time_edit",
    "editor_activity",
    "plagiarism_complete",
    "ai_suggestion",
    "ai_limit",
    "document_deadline",
    "document_exported",
    "new_feature",
    "weekly_summary",
    "payment_success",
    "subscription_renewed",
    "citation_reminder",
    "new_feature_announcement",
    "product_tip",
    "research_update",
    "template_update",
    "collaboration_session_started",
    "collaboration_session_ended",
    "subscription_created",
    "subscription_updated",
    "subscription_resumed",
    "payment_refunded",
    "backup_available",
    "document_version",
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
  ];

  const lowPrioNotifications = await prisma.notification.findMany({
    where: {
      type: { notIn: [...highPriorityTypes, ...mediumPriorityTypes] },
    },
    orderBy: { created_at: "desc" },
    take: 10,
  });

  console.log("\nLow priority query results:");
  console.log(
    JSON.stringify(
      lowPrioNotifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
      })),
      null,
      2,
    ),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
  });
