import { gaService } from "../services/admin/integrations/googleAnalyticsService";
import { prisma } from "../lib/prisma";

async function main() {
  try {
    const ga: any = await gaService.getDailyTraffic();
    console.log("GA4 daily rows:", (ga.rows || []).length);
    let users = 0, sessions = 0, pv = 0;
    for (const row of ga.rows || []) {
      const v = row.metricValues || [];
      users += Number(v[0]?.value) || 0;
      sessions += Number(v[2]?.value) || 0;
      pv += Number(v[3]?.value) || 0;
    }
    console.log("GA4 sums: users=", users, "sessions=", sessions, "pageviews=", pv);
  } catch (e: any) {
    console.log("GA4 error:", e.message);
  }

  const subStatuses: any = await prisma.$queryRaw`SELECT status, COUNT(*)::int as c FROM subscription GROUP BY status`;
  console.log("subscription statuses:", JSON.stringify(subStatuses));
  const subDates: any = await prisma.$queryRaw`SELECT MIN(created_at)::text as min_c, MAX(created_at)::text as max_c FROM subscription`;
  console.log("subscription created range:", JSON.stringify(subDates));
  process.exit(0);
}
main();
