import { initializePrisma } from "../src/lib/prisma-async";
import * as dotenv from "dotenv";

dotenv.config();

async function checkMessages() {
  const prisma = await initializePrisma();
  console.log("--- Checking Support Messages Table ---");
  try {
    const count = await (prisma as any).supportMessage.count();
    console.log(`Total messages in database: ${count}`);
    
    if (count > 0) {
      const latest = await (prisma as any).supportMessage.findMany({
        take: 5,
        orderBy: { received_at: 'desc' }
      });
      console.log("Latest messages:", latest.map((m: any) => ({
        subject: m.subject,
        sender: m.sender_email,
        received: m.received_at
      })));
    }
  } catch (err) {
    console.error("Error querying database:", err);
  }
  process.exit(0);
}

checkMessages().catch(console.error);
