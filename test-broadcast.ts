import { PrismaClient } from '@prisma/client';
import { broadcastWorkspaceNotification } from '../../backend/src/services/notificationService';

const prisma = new PrismaClient();

async function test() {
  // Find a workspace
  const workspace = await prisma.workspace.findFirst({
    include: {
      members: {
        include: { user: true }
      }
    }
  });

  if (!workspace || workspace.members.length < 2) {
    console.log("Need a workspace with at least 2 members to test.");
    return;
  }

  const actor = workspace.members[0];
  const recipient = workspace.members[1];
  
  console.log(`Testing with Actor: ${actor.user.full_name}, Recipient: ${recipient.user.full_name}`);
  
  await broadcastWorkspaceNotification(
    workspace.id,
    actor.user_id,
    "task_assigned",
    {
      actor: (actorName: string) => ({
        title: "Task Created",
        message: `You created task "Test Task".`
      }),
      recipient: (actorName: string) => ({
        title: "New Task Assigned",
        message: `${actorName} assigned you to task "Test Task".`
      }),
      others: (actorName: string, recipientName?: string) => ({
        title: "Task Created",
        message: `${actorName} created task "Test Task" and assigned ${recipientName}.`
      })
    },
    {
      taskId: "test-task-123",
      workspaceId: workspace.id,
    },
    [recipient.user_id]
  );
  
  console.log("Broadcasted notifications. Checking DB...");
  
  const notifications = await prisma.notification.findMany({
    where: {
      type: "task_assigned",
      data: {
        path: ['taskId'],
        equals: 'test-task-123'
      }
    }
  });
  
  notifications.forEach(n => {
    let role = "Other";
    if (n.user_id === actor.user_id) role = "Actor";
    if (n.user_id === recipient.user_id) role = "Recipient";
    console.log(`[${role}] Notification:`, n.title, "-", n.message);
  });
  
  // Cleanup
  await prisma.notification.deleteMany({
    where: {
      type: "task_assigned",
      data: {
        path: ['taskId'],
        equals: 'test-task-123'
      }
    }
  });
}

test()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
