"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const googleAnalyticsService_1 = require("../services/admin/integrations/googleAnalyticsService");
const prisma_1 = require("../lib/prisma");
async function main() {
    try {
        const ga = await googleAnalyticsService_1.gaService.getDailyTraffic();
        console.log("GA4 daily rows:", (ga.rows || []).length);
        let users = 0, sessions = 0, pv = 0;
        for (const row of ga.rows || []) {
            const v = row.metricValues || [];
            users += Number(v[0]?.value) || 0;
            sessions += Number(v[2]?.value) || 0;
            pv += Number(v[3]?.value) || 0;
        }
        console.log("GA4 sums: users=", users, "sessions=", sessions, "pageviews=", pv);
    }
    catch (e) {
        console.log("GA4 error:", e.message);
    }
    const subStatuses = await prisma_1.prisma.$queryRaw `SELECT status, COUNT(*)::int as c FROM subscription GROUP BY status`;
    console.log("subscription statuses:", JSON.stringify(subStatuses));
    const subDates = await prisma_1.prisma.$queryRaw `SELECT MIN(created_at)::text as min_c, MAX(created_at)::text as max_c FROM subscription`;
    console.log("subscription created range:", JSON.stringify(subDates));
    process.exit(0);
}
main();
