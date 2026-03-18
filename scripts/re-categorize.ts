import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function categorizeEmail(subject: string, body: string): { folder: string; priority: string } {
  const content = (subject + " " + body).toLowerCase();
  
  if (/billing|invoice|payment|subscription|refund|charge|receipt|premium|plan/i.test(content)) {
    return { folder: "Billing", priority: "high" };
  }
  
  if (/security|password|login|auth|hacked|verify|2fa|suspicious|unauthorized|breach/i.test(content)) {
    return { folder: "Security", priority: "high" };
  }
  
  if (/contact|hello|inquiry|question|help|request/i.test(content)) {
    return { folder: "Contact", priority: "medium" };
  }
  
  if (/system|update|maintenance|feature|feedback|platform|error|bug/i.test(content)) {
    return { folder: "Platform", priority: "medium" };
  }
  
  return { folder: "Support", priority: "medium" };
}

async function main() {
  const messages = await prisma.supportMessage.findMany({
    where: { OR: [{ folder: null }, { folder: 'Support' }] }
  });

  console.log(`Found ${messages.length} messages to categorize.`);

  for (const msg of messages) {
    const { folder, priority } = categorizeEmail(msg.subject, msg.message_text);
    await prisma.supportMessage.update({
      where: { id: msg.id },
      data: { folder, priority }
    });
    console.log(`Categorized: ${msg.subject.substring(0, 30)}... -> ${folder}`);
  }

  console.log("Done!");
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
