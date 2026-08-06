import express, { Router } from "express";
import os from "os";
import { isPlatformAdmin } from "../../middleware/platformAdmin";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { gaService } from "../../services/admin/integrations/googleAnalyticsService";

const router: Router = express.Router();

router.use(isPlatformAdmin);

// ────────────────────────────────────────────────
// Platform overview
// ────────────────────────────────────────────────
router.get("/platform", async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [totalUsers, activeUsers, totalDocuments, activeSessions] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { last_seen_at: { gte: thirtyDaysAgo } } }),
      prisma.project.count(),
      prisma.userSession.count({ where: { ended_at: null } }),
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // platform_metrics may not be migrated in every environment; degrade to zeros
    // instead of failing the whole overview.
    let apiCallsToday = 0;
    let apiTotal = 0;
    let errorTotal = 0;
    try {
      const apiMetrics = await prisma.platformMetric.findMany({
        where: { category: "api", recordedAt: { gte: thirtyDaysAgo } },
        select: { value: true, metricName: true },
      });
      const [apiCallsAgg, errorAgg] = await Promise.all([
        prisma.platformMetric.aggregate({
          where: { category: "api", recordedAt: { gte: today } },
          _sum: { value: true },
        }),
        prisma.platformMetric.aggregate({
          where: { category: "error", recordedAt: { gte: thirtyDaysAgo } },
          _sum: { value: true },
        }),
      ]);
      apiCallsToday = Math.round(apiCallsAgg._sum.value ?? 0);
      apiTotal = apiMetrics.reduce((sum: number, m: { value: number }) => sum + m.value, 0);
      errorTotal = errorAgg._sum.value ?? 0;
    } catch (err: any) {
      logger.warn(`platform_metrics table unavailable, using fallback: ${err.message}`);
    }

    const overview = {
      totalUsers,
      activeUsers,
      totalDocuments,
      activeSessions,
      apiCallsToday,
      errorRate: apiTotal > 0 ? Number(((errorTotal / apiTotal) * 100).toFixed(2)) : 0,
      avgResponseTime: 0,
      uptime: Math.floor(process.uptime()),
    };

    res.json({ success: true, data: overview });
  } catch (error: any) {
    logger.error("Analytics platform error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// User growth over time
// ────────────────────────────────────────────────
router.get("/user-growth", async (req, res) => {
  try {
    const period = String(req.query.period || "30d");
    const days = period === "7d" ? 7 : period === "90d" ? 90 : period === "12m" ? 365 : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const users = await prisma.user.findMany({
      where: { created_at: { gte: since } },
      select: { created_at: true, last_seen_at: true },
    });

    const data: { date: string; total: number; newUsers: number; active: number }[] = [];
    const bucket = new Map<string, { newUsers: number; active: number }>();
    let cumulative = 0;

    // Pre-query historical total for the cumulative baseline
    const before = await prisma.user.count({ where: { created_at: { lt: since } } });

    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      bucket.set(key, { newUsers: 0, active: 0 });
    }

    for (const u of users) {
      const key = u.created_at.toISOString().slice(0, 10);
      const entry = bucket.get(key);
      if (entry) entry.newUsers += 1;
      if (u.last_seen_at && u.last_seen_at >= since) {
        const seenKey = u.last_seen_at.toISOString().slice(0, 10);
        const seen = bucket.get(seenKey);
        if (seen) seen.active += 1;
      }
    }

    cumulative = before;
    for (const d of bucket.keys()) {
      const entry = bucket.get(d)!;
      cumulative += entry.newUsers;
      data.push({ date: d, total: cumulative, newUsers: entry.newUsers, active: entry.active });
    }

    res.json({ success: true, data: { data } });
  } catch (error: any) {
    logger.error("Analytics user-growth error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Daily platform series (new/active users, API calls) for comparisons
// ────────────────────────────────────────────────
router.get("/daily", async (req, res) => {
  try {
    const period = String(req.query.period || "7d");
    const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 7;
    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);

    const users = await prisma.user.findMany({
      where: { created_at: { gte: since } },
      select: { created_at: true, last_seen_at: true },
    });

    const bucket = new Map<string, { newUsers: number; activeUsers: number; apiCalls: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      bucket.set(d.toISOString().slice(0, 10), { newUsers: 0, activeUsers: 0, apiCalls: 0 });
    }

    for (const u of users) {
      const key = u.created_at.toISOString().slice(0, 10);
      const entry = bucket.get(key);
      if (entry) entry.newUsers += 1;
      if (u.last_seen_at && u.last_seen_at >= since) {
        const seenKey = u.last_seen_at.toISOString().slice(0, 10);
        const seen = bucket.get(seenKey);
        if (seen) seen.activeUsers += 1;
      }
    }

    // API calls: platform_metrics may be missing in some environments — degrade to zeros.
    let apiRows: { recordedAt: Date; value: number }[] = [];
    try {
      apiRows = await prisma.platformMetric.findMany({
        where: { category: "api", recordedAt: { gte: since } },
        select: { recordedAt: true, value: true },
      });
    } catch (err: any) {
      logger.warn(`platform_metrics table unavailable for daily series: ${err.message}`);
    }
    for (const m of apiRows) {
      const key = m.recordedAt.toISOString().slice(0, 10);
      const entry = bucket.get(key);
      if (entry) entry.apiCalls += Math.round(m.value);
    }

    const data = Array.from(bucket.entries()).map(([date, v]) => ({ date, ...v }));
    res.json({ success: true, data: { data } });
  } catch (error: any) {
    logger.error("Analytics daily error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Real conversion funnels (GA4 acquisition + platform product)
// ────────────────────────────────────────────────
router.get("/funnel", async (req, res) => {
  try {
    const period = String(req.query.period || "30d");
    const days = period === "7d" ? 7 : period === "90d" ? 90 : period === "12m" ? 365 : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    // Platform counts
    const [totalUsers, activeUsers, totalDocs, newUsers, paidSubs, currentPaidSubs] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { last_seen_at: { gte: since } } }),
      prisma.project.count({ where: { created_at: { gte: since } } }),
      prisma.user.count({ where: { created_at: { gte: since } } }),
      prisma.subscription.count({ where: { created_at: { gte: since } } }),
      prisma.subscription.count({ where: { status: { in: ["active", "on_trial", "trialing"] } } }),
    ]);

    // GA4 traffic — degrade to zeros if unconfigured / no rows
    let gaUsers = 0;
    let gaSessions = 0;
    let gaPageviews = 0;
    let gaConfigured = false;
    try {
      const ga = await gaService.getDailyTraffic();
      gaConfigured = true;
      for (const row of ga.rows || []) {
        const values = row.metricValues || [];
        gaUsers += Number(values[0]?.value) || 0;
        gaSessions += Number(values[2]?.value) || 0;
        gaPageviews += Number(values[3]?.value) || 0;
      }
    } catch (err: any) {
      logger.warn(`GA4 unavailable for funnel, using platform-only: ${err.message}`);
    }

    const toFunnel = (steps: { name: string; count: number; color: string }[]) => {
      const maxCount = Math.max(...steps.map((s) => s.count), 1);
      return steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].count : s.count;
        const percentage = maxCount > 0 ? Math.round((s.count / maxCount) * 1000) / 10 : 0;
        const dropoff = prev > 0 && s.count <= prev ? Number((((prev - s.count) / prev) * 100).toFixed(1)) : 0;
        return { ...s, percentage, dropoff };
      });
    };

    const acquisition = toFunnel([
      { name: "Page Views", count: gaPageviews, color: "#0ea5e9" },
      { name: "Sessions", count: gaSessions, color: "#6366f1" },
      { name: "Visitors", count: gaUsers, color: "#8b5cf6" },
      { name: "Sign Ups", count: newUsers, color: "#a855f7" },
    ]);

    const product = toFunnel([
      { name: "Sign Ups", count: newUsers, color: "#a855f7" },
      { name: "Active Users", count: activeUsers, color: "#22c55e" },
      { name: "Documents Created", count: totalDocs, color: "#f59e0b" },
      { name: "Paid Subscriptions", count: currentPaidSubs, color: "#ef4444" },
    ]);

    res.json({
      success: true,
      data: { acquisition, product, sources: { ga4: gaConfigured, platform: true }, totals: { totalUsers, gaUsers, gaSessions, gaPageviews } },
    });
  } catch (error: any) {
    logger.error("Analytics funnel error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Real user journey (GA4 visit → platform milestones)
// ────────────────────────────────────────────────
router.get("/journey", async (req, res) => {
  try {
    const period = String(req.query.period || "30d");
    const days = period === "7d" ? 7 : period === "90d" ? 90 : period === "12m" ? 365 : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const [newUsers, activeUsers, totalDocs, currentPaidSubs, totalUsers] = await Promise.all([
      prisma.user.count({ where: { created_at: { gte: since } } }),
      prisma.user.count({ where: { last_seen_at: { gte: since } } }),
      prisma.project.count({ where: { created_at: { gte: since } } }),
      prisma.subscription.count({ where: { status: { in: ["active", "on_trial", "trialing"] } } }),
      prisma.user.count(),
    ]);

    // GA4 visitors — degrade to zero if unavailable
    let gaUsers = 0;
    try {
      const ga = await gaService.getDailyTraffic();
      for (const row of ga.rows || []) {
        gaUsers += Number(row.metricValues?.[0]?.value) || 0;
      }
    } catch (err: any) {
      logger.warn(`GA4 unavailable for journey, using platform-only: ${err.message}`);
    }

    const rawSteps = [
      { name: "Visit", users: gaUsers, color: "#0ea5e9" },
      { name: "Sign Up", users: newUsers, color: "#6366f1" },
      { name: "Active User", users: activeUsers, color: "#22c55e" },
      { name: "First Document", users: totalDocs, color: "#f59e0b" },
      { name: "Paid Subscription", users: currentPaidSubs, color: "#ef4444" },
    ];

    const maxUsers = Math.max(...rawSteps.map((s) => s.users), 1);
    const steps = rawSteps.map((s, i) => {
      const prev = i > 0 ? rawSteps[i - 1].users : s.users;
      const dropoff = prev > 0 && s.users <= prev ? Number((((prev - s.users) / prev) * 100).toFixed(1)) : 0;
      return {
        name: s.name,
        users: s.users,
        color: s.color,
        percentage: Math.round((s.users / maxUsers) * 1000) / 10,
        dropoff,
        avgTimeSpent: "—",
      };
    });

    res.json({ success: true, data: { steps, totals: { totalUsers, gaUsers } } });
  } catch (error: any) {
    logger.error("Analytics journey error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Real conversion events (GA4 events + platform subscriptions/payments)
// ────────────────────────────────────────────────
router.get("/conversions", async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [subscriptions, payments, totalUsers] = await Promise.all([
      prisma.subscription.findMany({ select: { plan: true, status: true, created_at: true } }),
      prisma.paymentHistory.findMany({ select: { amount: true, description: true, created_at: true } }),
      prisma.user.count(),
    ]);

    // Platform-derived conversions
    const planCounts = new Map<string, number>();
    let paidCount = 0;
    for (const s of subscriptions) {
      planCounts.set(s.plan, (planCounts.get(s.plan) || 0) + 1);
      if (s.status === "active" || s.status === "on_trial" || s.status === "trialing") paidCount += 1;
    }

    const revenueTotal = payments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);
    const totalRevenue = payments.length > 0 ? Number((revenueTotal / 100).toFixed(2)) : 0;

    // GA4 events as conversions
    let gaConversions: any[] = [];
    try {
      const ga = await gaService.getEvents();
      for (const row of ga.rows || []) {
        const values = row.metricValues || [];
        gaConversions.push({
          id: `ga_${row.dimensionValues?.[0]?.value || "evt"}`,
          name: row.dimensionValues?.[0]?.value || "unknown",
          category: "GA4",
          count: Number(values[0]?.value) || 0,
          conversionRate: totalUsers > 0 ? Number(((Number(values[0]?.value) || 0) / totalUsers) * 100).toFixed(1) : "0.0",
          revenue: 0,
          trend: "flat" as const,
        });
      }
    } catch (err: any) {
      logger.warn(`GA4 events unavailable for conversions: ${err.message}`);
    }

    const data = [
      {
        id: "sub_plans",
        name: "Active Paid Subscriptions",
        category: "Billing",
        count: paidCount,
        conversionRate: totalUsers > 0 ? Number(((paidCount / totalUsers) * 100).toFixed(1)) : 0,
        revenue: totalRevenue,
        trend: paidCount > 0 ? ("up" as const) : ("flat" as const),
      },
      ...Array.from(planCounts.entries()).map(([plan, count], i) => ({
        id: `plan_${i}`,
        name: `${plan} Plan`,
        category: "Plan",
        count,
        conversionRate: totalUsers > 0 ? Number(((count / totalUsers) * 100).toFixed(1)) : 0,
        revenue: 0,
        trend: "flat" as const,
      })),
      ...gaConversions,
    ];

    res.json({ success: true, data: { data, sources: { ga4: gaConversions.length > 0, platform: true } } });
  } catch (error: any) {
    logger.error("Analytics conversions error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// API metrics
// ────────────────────────────────────────────────
router.get("/api", async (req, res) => {
  try {
    const period = String(req.query.period || "30d");
    const days = period === "7d" ? 7 : period === "90d" ? 90 : period === "12m" ? 365 : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    let rows: { metricName: string; _sum: { value: number | null } | null; _count: number }[] = [];
    try {
      rows = await prisma.platformMetric.groupBy({
        by: ["metricName"],
        where: { category: "api", recordedAt: { gte: since } },
        _sum: { value: true },
        _count: true,
        orderBy: { metricName: "asc" },
      });
    } catch (err: any) {
      logger.warn(`platform_metrics table unavailable, returning empty API metrics: ${err.message}`);
    }

    const data = rows.map((r: { metricName: string; _sum: { value: number | null } | null; _count: number }) => ({
      endpoint: r.metricName,
      method: "GET",
      count: Math.round(r._sum?.value ?? 0),
      avgLatencyMs: 0,
      p99LatencyMs: 0,
      errorRate: 0,
    }));

    res.json({ success: true, data: { data } });
  } catch (error: any) {
    logger.error("Analytics api error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Error metrics
// ────────────────────────────────────────────────
router.get("/errors", async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let rows: { metricName: string; _sum: { value: number | null } | null; _max: { recordedAt: Date | null } | null }[] = [];
    try {
      rows = await prisma.platformMetric.groupBy({
        by: ["metricName"],
        where: { category: "error", recordedAt: { gte: thirtyDaysAgo } },
        _sum: { value: true },
        _max: { recordedAt: true },
        orderBy: { metricName: "asc" },
      });
    } catch (err: any) {
      logger.warn(`platform_metrics table unavailable, returning empty error metrics: ${err.message}`);
    }

    const totalErrors = rows.reduce((sum: number, r: { _sum: { value: number | null } | null }) => sum + (r._sum?.value ?? 0), 0);
    const data = rows.map((r: { metricName: string; _sum: { value: number | null } | null; _max: { recordedAt: Date | null } | null }) => ({
      message: r.metricName,
      count: Math.round(r._sum?.value ?? 0),
      percentage: totalErrors > 0 ? Number((((r._sum?.value ?? 0) / totalErrors) * 100).toFixed(1)) : 0,
      lastOccurrence: r._max?.recordedAt?.toISOString() ?? new Date().toISOString(),
    }));

    res.json({ success: true, data: { data } });
  } catch (error: any) {
    logger.error("Analytics errors error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Feature usage
// ────────────────────────────────────────────────
router.get("/usage", async (req, res) => {
  try {
    const period = String(req.query.period || "30d");
    const days = period === "7d" ? 7 : period === "90d" ? 90 : period === "12m" ? 365 : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    let rows = await prisma.usageTracking.groupBy({
      by: ["feature"],
      where: { period_start: { gte: since } },
      _sum: { count: true },
      _count: true,
      orderBy: { feature: "asc" },
    });

    // Usage periods are snapshots; fall back to all recorded usage if the
    // selected window is empty so the tab never shows "No usage data".
    if (rows.length === 0) {
      rows = await prisma.usageTracking.groupBy({
        by: ["feature"],
        _sum: { count: true },
        _count: true,
        orderBy: { feature: "asc" },
      });
    }

    const data = rows.map((r: { feature: string; _sum: { count: number | null } | null; _count: number }) => ({
      metric: r.feature,
      value: r._sum?.count ?? 0,
      unit: "uses",
      change: 0,
    }));

    res.json({ success: true, data: { data } });
  } catch (error: any) {
    logger.error("Analytics usage error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Resource metrics
// ────────────────────────────────────────────────
router.get("/resources", async (req, res) => {
  try {
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const heapUsagePct = mem.heapTotal > 0 ? (mem.heapUsed / mem.heapTotal) * 100 : 0;

    const data = [
      {
        name: "Memory Usage",
        value: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
        unit: "MB",
        maxValue: Number((mem.heapTotal / 1024 / 1024).toFixed(1)),
        status: heapUsagePct > 90 ? "critical" : heapUsagePct > 70 ? "warning" : "healthy",
      },
      {
        name: "RSS",
        value: Number((mem.rss / 1024 / 1024).toFixed(1)),
        unit: "MB",
        maxValue: Number((totalMem / 1024 / 1024).toFixed(1)),
        status: mem.rss / totalMem > 0.7 ? "warning" : "healthy",
      },
      {
        name: "System Memory",
        value: Number(((totalMem - freeMem) / 1024 / 1024 / 1024).toFixed(1)),
        unit: "GB",
        maxValue: Number((totalMem / 1024 / 1024 / 1024).toFixed(1)),
        status: (totalMem - freeMem) / totalMem > 0.9 ? "critical" : (totalMem - freeMem) / totalMem > 0.7 ? "warning" : "healthy",
      },
      {
        name: "Load Average",
        value: Number(os.loadavg()[0].toFixed(2)),
        unit: "load",
        maxValue: os.cpus().length,
        status: os.loadavg()[0] / os.cpus().length > 1 ? "warning" : "healthy",
      },
    ];

    res.json({ success: true, data: { data } });
  } catch (error: any) {
    logger.error("Analytics resources error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Operations KPIs
// ────────────────────────────────────────────────
router.get("/operations", async (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
    const d60 = new Date(now); d60.setDate(d60.getDate() - 60);

    const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : cur > 0 ? 100 : 0);
    const dir = (change: number) => (change > 0 ? "up" : change < 0 ? "down" : "flat");

    const [totalUsers, newUsers, newUsersPrev, activeUsers, activeUsersPrev, docs30, docsPrev, payments30, paymentsPrev] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { created_at: { gte: d30 } } }),
      prisma.user.count({ where: { created_at: { gte: d60, lt: d30 } } }),
      prisma.user.count({ where: { last_seen_at: { gte: d30 } } }),
      prisma.user.count({ where: { last_seen_at: { gte: d60, lt: d30 } } }),
      prisma.project.count({ where: { created_at: { gte: d30 } } }),
      prisma.project.count({ where: { created_at: { gte: d60, lt: d30 } } }),
      prisma.paymentHistory.count({ where: { created_at: { gte: d30 } } }),
      prisma.paymentHistory.count({ where: { created_at: { gte: d60, lt: d30 } } }),
    ]);

    // Email log / support / backup may not be migrated in every environment; degrade to zero.
    let emails30 = 0;
    let emailsPrev = 0;
    let supportOpen = 0;
    try {
      [emails30, emailsPrev] = await Promise.all([
        prisma.emailLog.count({ where: { sent_at: { gte: d30 } } }),
        prisma.emailLog.count({ where: { sent_at: { gte: d60, lt: d30 } } }),
      ]);
    } catch (err: any) {
      logger.warn(`email_logs table unavailable, using fallback: ${err.message}`);
    }
    try {
      supportOpen = await prisma.supportMessage.count({ where: { status: "open" } });
    } catch (err: any) {
      logger.warn(`support_messages table unavailable, using fallback: ${err.message}`);
    }
    let backupsFailed = 0;
    try {
      backupsFailed = await prisma.backupRecord.count({ where: { status: "failed" } });
    } catch (err: any) {
      logger.warn(`backup_records table unavailable, using fallback: ${err.message}`);
    }

    // `icon` is a lucide icon-name string; the frontend maps it to a component.
    const totalUsersChange = totalUsers - newUsers > 0 ? Math.round((newUsers / (totalUsers - newUsers)) * 100) : newUsers > 0 ? 100 : 0;
    const data = [
      { label: "Total Users", value: String(totalUsers), change: totalUsersChange, changeDir: dir(totalUsersChange), icon: "users", color: "text-sky-500", bg: "bg-sky-500/10" },
      { label: "New Users (30d)", value: String(newUsers), change: pct(newUsers, newUsersPrev), changeDir: dir(pct(newUsers, newUsersPrev)), icon: "users", color: "text-indigo-500", bg: "bg-indigo-500/10" },
      { label: "Active Users (30d)", value: String(activeUsers), change: pct(activeUsers, activeUsersPrev), changeDir: dir(pct(activeUsers, activeUsersPrev)), icon: "activity", color: "text-emerald-500", bg: "bg-emerald-500/10" },
      { label: "Emails Sent (30d)", value: String(emails30), change: pct(emails30, emailsPrev), changeDir: dir(pct(emails30, emailsPrev)), icon: "mail", color: "text-violet-500", bg: "bg-violet-500/10" },
      { label: "Docs Created (30d)", value: String(docs30), change: pct(docs30, docsPrev), changeDir: dir(pct(docs30, docsPrev)), icon: "file-text", color: "text-amber-500", bg: "bg-amber-500/10" },
      { label: "Payments (30d)", value: String(payments30), change: pct(payments30, paymentsPrev), changeDir: dir(pct(payments30, paymentsPrev)), icon: "credit-card", color: "text-cyan-500", bg: "bg-cyan-500/10" },
      { label: "Open Support", value: String(supportOpen), change: 0, changeDir: "flat", icon: "message-square", color: "text-rose-500", bg: "bg-rose-500/10" },
      { label: "Failed Backups", value: String(backupsFailed), change: 0, changeDir: "flat", icon: "database", color: "text-red-500", bg: "bg-red-500/10" },
    ];

    res.json({ success: true, data: { data } });
  } catch (error: any) {
    logger.error("Analytics operations error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
