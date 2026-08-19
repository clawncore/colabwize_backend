import express, { Router } from "express";
import os from "os";
import { isPlatformAdmin } from "../../middleware/platformAdmin";
import { adminOperationRateLimiter } from "../../middleware/rateLimiter";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { metrics } from "../../monitoring/metrics";
import { gaService } from "../../services/admin/integrations/googleAnalyticsService";

const router: Router = express.Router();

router.use(isPlatformAdmin);
router.use(adminOperationRateLimiter);

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

    // Real request timing from the in-memory metrics registry. Falls back to 0
    // only when no request has been observed since the process started.
    const timing = metrics.getTimingStats("http_request_duration");
    const overview = {
      totalUsers,
      activeUsers,
      totalDocuments,
      activeSessions,
      apiCallsToday,
      errorRate: apiTotal > 0 ? Number(((errorTotal / apiTotal) * 100).toFixed(2)) : 0,
      avgResponseTime: timing ? Number(timing.avg.toFixed(1)) : 0,
      p50ResponseTime: timing ? Number(timing.p50.toFixed(1)) : 0,
      p95ResponseTime: timing ? Number(timing.p95.toFixed(1)) : 0,
      p99ResponseTime: timing ? Number(timing.p99.toFixed(1)) : 0,
      requestCount: timing?.count ?? 0,
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

    // API calls: prefer the live per-day registry from the metrics middleware;
    // fall back to platform_metrics (often empty) if the registry has no rows.
    const dailyApi = metrics.getDailyApiCalls();
    if (dailyApi.size > 0) {
      for (const [key, count] of dailyApi.entries()) {
        const entry = bucket.get(key);
        if (entry) entry.apiCalls += count;
      }
    } else {
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

    // Build the funnel from a single sign-up cohort so every step is nested
    // under the previous one (counts must decrease — a funnel can never show
    // "12 paid" above "0 visits").
    const totalUsers = await prisma.user.count();

    // Users who signed up within the window (top of the platform funnel).
    const signupUsers: {
      id: string;
      created_at: Date;
      last_seen_at: Date | null;
      _count: { projects: number };
    }[] = await prisma.user.findMany({
      where: { created_at: { gte: since } },
      select: {
        id: true,
        created_at: true,
        last_seen_at: true,
        _count: { select: { projects: true } },
      },
    });
    const signupIds = signupUsers.map((u) => u.id);
    const newUsers = signupUsers.length;

    // Active User = signed up in window AND seen within the window.
    const activeUsers = signupUsers.filter((u) => u.last_seen_at && u.last_seen_at >= since).length;

    // First Document = signed up in window AND created at least one project in window.
    const firstDocUsers = signupUsers.filter((u) => u._count.projects > 0).length;

    // Paid Subscription = signed up in window AND holds an active/trialing sub
    // (counted from the cohort, not the global subscription table).
    let paidUsers = 0;
    let paidSince = 0;
    if (signupIds.length > 0) {
      const cohortSubs: { user_id: string; created_at: Date }[] = await prisma.subscription.findMany({
        where: {
          user_id: { in: signupIds },
          status: { in: ["active", "on_trial", "trialing"] },
        },
        select: { user_id: true, created_at: true },
      });
      paidUsers = cohortSubs.length;
      paidSince = cohortSubs.filter((s) => s.created_at >= since).length;
    }
    const paid = Math.max(paidUsers, paidSince); // cohort subs are all within sign-up window

    // GA4 visitors — the only non-platform step. When GA4 is unconfigured we
    // omit "Visit" entirely rather than showing a misleading 0.
    let gaUsers = 0;
    let gaAvailable = true;
    try {
      const ga = await gaService.getDailyTraffic();
      for (const row of ga.rows || []) {
        gaUsers += Number(row.metricValues?.[0]?.value) || 0;
      }
    } catch (err: any) {
      gaAvailable = false;
      logger.warn(`GA4 unavailable for journey, using platform-only: ${err.message}`);
    }

    // Average time-to-engagement for the Active User step (created -> last seen).
    // Other steps are entry points (Sign Up) or have no per-user timestamp (Visit,
    // First Document, Paid), so they stay honest as "—".
    const avgTimeToActive = () => {
      const engaged = signupUsers
        .filter((u) => u.last_seen_at && u.created_at)
        .map((u) => (u.last_seen_at!.getTime() - u.created_at!.getTime()) / 1000);
      if (engaged.length === 0) return "—";
      const avgSec = engaged.reduce((s, v) => s + v, 0) / engaged.length;
      if (avgSec < 3600) return `${Math.max(1, Math.round(avgSec / 60))} min`;
      if (avgSec < 86400) return `${Math.round(avgSec / 3600)} hr`;
      return `${Math.round(avgSec / 86400)} d`;
    };

    const rawSteps = [
      ...(gaAvailable
        ? [{ name: "Visit", users: gaUsers, color: "#0ea5e9", time: "—" as string }]
        : []),
      { name: "Sign Up", users: newUsers, color: "#6366f1", time: "—" },
      { name: "Active User", users: activeUsers, color: "#22c55e", time: avgTimeToActive() },
      { name: "First Document", users: firstDocUsers, color: "#f59e0b", time: "—" },
      { name: "Paid Subscription", users: paid, color: "#ef4444", time: "—" },
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
        avgTimeSpent: s.time,
      };
    });

    res.json({
      success: true,
      data: {
        steps,
        totals: { totalUsers, gaUsers },
        source: gaAvailable ? "ga4+platform" : "platform",
      },
    });
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
// Event tracking (usage_events + analytics_events + GA4 events)
// ────────────────────────────────────────────────
// Real user-event tracking. Sources:
//   - usage_events     (credit/plan feature usage, the primary event stream)
//   - analytics_events (frontend/backend analytics pings, e.g. periodic_scan)
//   - GA4 events       (when connected)
router.get("/events", async (req, res) => {
  try {
    const period = String(req.query.period || "30d");
    const days = period === "7d" ? 7 : period === "90d" ? 90 : period === "12m" ? 365 : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const search = String(req.query.search || "").toLowerCase();
    const category = String(req.query.category || "all").toLowerCase();
    const matches = (s: string) => (!search || s.toLowerCase().includes(search)) && (category === "all" || s.toLowerCase() === category);

    const data: {
      id: string;
      event: string;
      category: string;
      count: number;
      users: number;
      source: string;
      timestamp: string;
    }[] = [];

    // 1) usage_events — credit/plan feature usage.
    const usageEvents = await prisma.usageEvent.groupBy({
      by: ["feature", "source"],
      where: { held_at: { gte: since } },
      _count: { _all: true },
      _min: { held_at: true },
    });

    for (const r of usageEvents as any[]) {
      const name = r.feature || "usage";
      const cat = r.source === "CREDIT" ? "CREDIT" : "PLAN";
      if (!matches(`${name} ${cat}`)) continue;
      data.push({
        id: `usage_${name}_${cat}`,
        event: name,
        category: cat,
        count: r._count._all || 0,
        users: r._count._all || 0,
        source: "usage_events",
        timestamp: r._min.held_at?.toISOString() || new Date().toISOString(),
      });
    }

    // 2) analytics_events — frontend/backend pings grouped by type+name.
    const analyticsRows = await prisma.analyticsEvent.groupBy({
      by: ["event_type", "event_name"],
      where: { timestamp: { gte: since } },
      _count: { _all: true },
      _min: { timestamp: true },
    });
    for (const r of analyticsRows as any[]) {
      const name = r.event_name || r.event_type || "event";
      if (!matches(`${name} ${r.event_type || ""}`)) continue;
      data.push({
        id: `analytics_${r.event_type}_${r.event_name}`,
        event: name,
        category: r.event_type || "ANALYTICS",
        count: r._count._all || 0,
        users: r._count._all || 0,
        source: "analytics_events",
        timestamp: r._min.timestamp?.toISOString() || new Date().toISOString(),
      });
    }

    // 3) GA4 events (when connected).
    try {
      const ga = await gaService.getEvents();
      for (const row of ga.rows || []) {
        const name = row.dimensionValues?.[0]?.value || "unknown";
        const count = Number(row.metricValues?.[0]?.value) || 0;
        const users = Number(row.metricValues?.[1]?.value) || 0;
        if (!matches(`${name} GA4`)) continue;
        data.push({
          id: `ga_${name}`,
          event: name,
          category: "GA4",
          count,
          users,
          source: "GA4",
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err: any) {
      logger.warn(`GA4 events unavailable: ${err.message}`);
    }

    data.sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      data: {
        data,
        sources: {
          usage: true,
          analytics: analyticsRows.length > 0,
          ga4: false,
        },
      },
    });
  } catch (error: any) {
    logger.error("Analytics events error:", error);
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

    // Primary source of truth: the per-route timing data collected by the
    // metrics middleware. The platformMetric table (if present) is used as a
    // fallback for historical endpoint counts, but latency always comes from
    // the registry so we never report fabricated zeros.
    const summary = metrics.getSummary();
    const perRouteTimings = summary.routeTimings;
    const totalRequests = (summary.counters["http_requests_total"] as number) || 0;
    const errorTotal = (summary.counters["http_responses_5xx_total"] as number) || 0;
    const routeErrorRate = totalRequests > 0 ? Number(((errorTotal / totalRequests) * 100).toFixed(2)) : 0;

    const data: {
      endpoint: string;
      method: string;
      count: number;
      avgLatencyMs: number;
      p99LatencyMs: number;
      errorRate: number;
    }[] = [];

    if (perRouteTimings && Array.isArray(perRouteTimings)) {
      for (const r of perRouteTimings as { route: string; method: string; count: number; avg: number; p99: number }[]) {
        data.push({
          endpoint: r.route,
          method: r.method,
          count: r.count,
          avgLatencyMs: Number(r.avg.toFixed(1)),
          p99LatencyMs: Number(r.p99.toFixed(1)),
          errorRate: 0,
        });
      }
    }

    // Historical counts from platform_metrics (if migrated) complement the
    // runtime registry but never fabricate latency.
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
      logger.warn(`platform_metrics table unavailable, returning runtime API metrics only: ${err.message}`);
    }

    const known = new Set(data.map((d) => d.endpoint));
    for (const r of rows) {
      if (known.has(r.metricName)) continue;
      data.push({
        endpoint: r.metricName,
        method: "GET",
        count: Math.round(r._sum?.value ?? 0),
        avgLatencyMs: 0,
        p99LatencyMs: 0,
        errorRate: 0,
      });
    }

    data.sort((a, b) => b.count - a.count);

    res.json({ success: true, data: { data, summary: { totalRequests, errorRate: routeErrorRate } } });
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
// Resource metrics (live machine + process gauges)
// ────────────────────────────────────────────────
// Sampled live per request; never fabricated. Covers the Node process (RSS,
// heap, CPU, uptime) and the host (system memory, load average, request rate).
router.get("/resources", async (req, res) => {
  try {
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const coreCount = os.cpus().length;
    const load1 = os.loadavg()[0];

    const heapUsagePct = mem.heapTotal > 0 ? (mem.heapUsed / mem.heapTotal) * 100 : 0;
    const sysMemUsedPct = totalMem > 0 ? (totalMem - freeMem) / totalMem : 0;
    const rssPct = totalMem > 0 ? mem.rss / totalMem : 0;
    const loadPct = coreCount > 0 ? load1 / coreCount : 0;

    // Live CPU usage via process.cpuUsage() deltas since process start.
    // times().system + times().user = total CPU ms the process has consumed.
    const cpuTimes = process.cpuUsage();
    const cpuPct = Math.min(100, Number(((cpuTimes.user + cpuTimes.system) / 1000 / Math.max(process.uptime(), 1)).toFixed(1)));

    // Request volume: total + a rolling per-second rate derived from the last
    // two /resources samples (module-scope state).
    const requestsTotal = metrics.getCounter("http_requests_total");
    const nowMs = Date.now();
    const reqRate = (() => {
      const prev = lastResourceSample;
      lastResourceSample = { at: nowMs, count: requestsTotal };
      if (!prev || prev.at <= 0 || nowMs === prev.at) return 0;
      const dtSec = (nowMs - prev.at) / 1000;
      if (dtSec <= 0 || requestsTotal < prev.count) return 0;
      return Number(((requestsTotal - prev.count) / dtSec).toFixed(2));
    })();
    const errorTotal = metrics.getCounter("http_responses_5xx_total");

    const uptimeSec = process.uptime();
    const hh = String(Math.floor(uptimeSec / 3600)).padStart(2, "0");
    const mm = String(Math.floor((uptimeSec % 3600) / 60)).padStart(2, "0");
    const ss = String(Math.floor(uptimeSec % 60)).padStart(2, "0");

    const data = [
      {
        name: "Process Memory (RSS)",
        description: "Node.js process memory in use vs system total",
        value: Number((mem.rss / 1024 / 1024).toFixed(1)),
        unit: "MB",
        maxValue: Number((Math.min(totalMem, 512 * 1024 * 1024) / 1024 / 1024).toFixed(1)),
        status: rssPct > 0.9 ? "critical" : rssPct > 0.7 ? "warning" : "healthy",
      },
      {
        name: "Heap Used",
        description: "V8 heap in use vs heap limit",
        value: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
        unit: "MB",
        maxValue: Number((mem.heapTotal / 1024 / 1024).toFixed(1)),
        status: heapUsagePct > 90 ? "critical" : heapUsagePct > 70 ? "warning" : "healthy",
      },
      {
        name: "CPU Usage",
        description: "Process CPU time since start vs elapsed time",
        value: cpuPct,
        unit: "%",
        maxValue: 100,
        status: cpuPct > 90 ? "critical" : cpuPct > 70 ? "warning" : "healthy",
      },
      {
        name: "Load Average",
        description: "1-minute run-queue length vs CPU cores",
        value: Number(load1.toFixed(2)),
        unit: "core",
        maxValue: coreCount,
        status: loadPct > 1 ? "warning" : loadPct > 0.85 ? "warning" : "healthy",
      },
      {
        name: "System Memory",
        description: "Host RAM in use vs total",
        value: Number(((totalMem - freeMem) / 1024 / 1024 / 1024).toFixed(1)),
        unit: "GB",
        maxValue: Number((totalMem / 1024 / 1024 / 1024).toFixed(1)),
        status: sysMemUsedPct > 0.9 ? "critical" : sysMemUsedPct > 0.7 ? "warning" : "healthy",
      },
      {
        name: "Uptime",
        description: "Time since the backend process started",
        value: uptimeSec,
        unit: "s",
        maxValue: uptimeSec,
        status: "healthy",
      },
      {
        name: "Requests",
        description: "Live HTTP requests counted by the metrics middleware",
        value: requestsTotal,
        unit: "req",
        maxValue: requestsTotal,
        status: "healthy",
      },
      {
        name: "Request Rate",
        description: "Rolling requests/second between samples",
        value: reqRate,
        unit: "/s",
        maxValue: reqRate,
        status: reqRate > 50 ? "warning" : "healthy",
      },
      {
        name: "5xx Errors",
        description: "HTTP 5xx responses counted live",
        value: errorTotal,
        unit: "err",
        maxValue: errorTotal,
        status: errorTotal > 0 ? "warning" : "healthy",
      },
    ];

    res.json({
      success: true,
      data: {
        data,
        meta: {
          cores: coreCount,
          uptimeFormatted: `${hh}:${mm}:${ss}`,
          heapUsedPct: Number(heapUsagePct.toFixed(1)),
          rssPct: Number((rssPct * 100).toFixed(1)),
          sysMemUsedPct: Number((sysMemUsedPct * 100).toFixed(1)),
          loadPct: Number((loadPct * 100).toFixed(1)),
          requestsTotal,
          requestRate: reqRate,
          errorTotal,
        },
      },
    });
  } catch (error: any) {
    logger.error("Analytics resources error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Module-scope state used to compute a rolling request rate between samples.
let lastResourceSample: { at: number; count: number } | null = null;

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

    // Add free tool usage to KPIs
    const toolEventNames = [
      "paraphrasing_tool_used",
      "plagiarism_checker_used",
      "citation_generator_used",
    ];

    const freeToolEvents = await prisma.analyticsEvent.count({
      where: {
        eventName: { in: toolEventNames },
        createdAt: { gte: d30 },
      },
    });
    const freeToolEventsPrev = await prisma.analyticsEvent.count({
      where: {
        eventName: { in: toolEventNames },
        createdAt: { gte: d60, lt: d30 },
      },
    });

    // `icon` is a lucide icon-name string; the frontend maps it to a component.
    const totalUsersChange = totalUsers - newUsers > 0 ? Math.round((newUsers / (totalUsers - newUsers)) * 100) : newUsers > 0 ? 100 : 0;
    const data = [
      { label: "Total Users", value: String(totalUsers), change: totalUsersChange, changeDir: dir(totalUsersChange), icon: "users", color: "text-sky-500", bg: "bg-sky-500/10" },
      { label: "New Users (30d)", value: String(newUsers), change: pct(newUsers, newUsersPrev), changeDir: dir(pct(newUsers, newUsersPrev)), icon: "users", color: "text-indigo-500", bg: "bg-indigo-500/10" },
      { label: "Active Users (30d)", value: String(activeUsers), change: pct(activeUsers, activeUsersPrev), changeDir: dir(pct(activeUsers, activeUsersPrev)), icon: "activity", color: "text-emerald-500", bg: "bg-emerald-500/10" },
      { label: "Emails Sent (30d)", value: String(emails30), change: pct(emails30, emailsPrev), changeDir: dir(pct(emails30, emailsPrev)), icon: "mail", color: "text-violet-500", bg: "bg-violet-500/10" },
      { label: "Docs Created (30d)", value: String(docs30), change: pct(docs30, docsPrev), changeDir: dir(pct(docs30, docsPrev)), icon: "file-text", color: "text-amber-500", bg: "bg-amber-500/10" },
      { label: "Free Tool Uses (30d)", value: String(freeToolEvents), change: pct(freeToolEvents, freeToolEventsPrev), changeDir: dir(pct(freeToolEvents, freeToolEventsPrev)), icon: "zap", color: "text-pink-500", bg: "bg-pink-500/10" },
      { label: "Payments (30d)", value: String(payments30), change: pct(payments30, paymentsPrev), changeDir: dir(pct(payments30, paymentsPrev)), icon: "credit-card", color: "text-cyan-500", bg: "bg-cyan-500/10" },
      { label: "Open Support", value: String(supportOpen), change: 0, changeDir: "flat", icon: "message-square", color: "text-rose-500", bg: "bg-rose-500/10" },
    ];

    res.json({ success: true, data: { data } });
  } catch (error: any) {
    logger.error("Analytics operations error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Blog engagement analytics (platform counts + GA4 page views)
// ────────────────────────────────────────────────
router.get("/blogs/analytics", async (req, res) => {
  try {
    const posts = await prisma.blogPost.findMany({
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        slug: true,
        title: true,
        is_published: true,
        view_count: true,
        read_count: true,
        like_count: true,
        published_at: true,
        created_at: true,
      },
    });

    // Pull per-page GA4 views when configured; fall back to platform counts only.
    let pageViews: { pagePath: string; views: number }[] = [];
    let ga4Configured = false;
    try {
      const status = gaService.getStatus();
      if (status.isConfigured) {
        ga4Configured = true;
        pageViews = await gaService.getPageViewsByPath(30);
      }
    } catch (err: any) {
      logger.warn(`[Blog Analytics] GA4 unavailable, falling back to platform counts: ${err.message}`);
    }

    // Index GA4 rows by both the slug URL and the id URL (SPA links use either).
    const gaIndex = new Map<string, number>();
    for (const row of pageViews) {
      gaIndex.set(row.pagePath, (gaIndex.get(row.pagePath) || 0) + row.views);
    }

    const data = posts.map((p: (typeof posts)[number]) => {
      const slugViews = gaIndex.get(`/resources/blogs/${p.slug}`) || 0;
      const idViews = gaIndex.get(`/resources/blogs/${p.id}`) || 0;
      const gaViews = Math.max(slugViews, idViews);
      // Platform view_count and GA4 page views are different pipelines; show the
      // larger honest number rather than double-counting the same visit.
      const views = Math.max(p.view_count, gaViews);
      return {
        id: p.id,
        slug: p.slug,
        title: p.title,
        is_published: p.is_published,
        published_at: p.published_at,
        created_at: p.created_at,
        views,
        platformViews: p.view_count,
        gaViews,
        readers: views,
        reads: p.read_count,
        likes: p.like_count,
        growth: null as number | null,
      };
    });

    res.json({
      success: true,
      data,
      meta: {
        source: ga4Configured ? "ga4+platform" : "platform",
        ga4Configured,
        totalPosts: posts.length,
        published: posts.filter((p: (typeof posts)[number]) => p.is_published).length,
      },
    });
  } catch (error: any) {
    logger.error("Analytics blogs error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────
// Free Tools Usage Analytics
// ────────────────────────────────────────────────
router.get("/tools", async (req, res) => {
  try {
    const period = String(req.query.period || "30d");
    const days = period === "7d" ? 7 : period === "90d" ? 90 : period === "12m" ? 365 : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Free tools we track
    const toolEventNames = [
      "paraphrasing_tool_used",
      "plagiarism_checker_used",
      "citation_generator_used",
    ];

    const events = await prisma.analyticsEvent.findMany({
      where: {
        eventName: { in: toolEventNames },
        createdAt: { gte: since },
      },
      select: {
        eventName: true,
        eventData: true,
        createdAt: true,
        userId: true,
      },
    });

    // Aggregate by tool
    const toolStats = new Map<
      string,
      {
        totalUses: number;
        uniqueUsers: Set<string>;
        daily: Map<string, number>;
        avgWordCount: number;
        wordCountSum: number;
      }
    >();

    for (const e of events) {
      let stats = toolStats.get(e.eventName);
      if (!stats) {
        stats = {
          totalUses: 0,
          uniqueUsers: new Set(),
          daily: new Map(),
          avgWordCount: 0,
          wordCountSum: 0,
        };
        toolStats.set(e.eventName, stats);
      }
      stats.totalUses += 1;
      stats.uniqueUsers.add(e.userId);
      const dayKey = e.createdAt.toISOString().slice(0, 10);
      stats.daily.set(dayKey, (stats.daily.get(dayKey) || 0) + 1);
      if (e.eventData?.wordCount) {
        stats.wordCountSum += e.eventData.wordCount;
        stats.avgWordCount = Math.round(stats.wordCountSum / stats.totalUses);
      }
    }

    // Build daily series
    const dailySeries: { date: string; paraphrasing: number; plagiarism: number; citation: number }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      dailySeries.push({
        date: key,
        paraphrasing: toolStats.get("paraphrasing_tool_used")?.daily.get(key) || 0,
        plagiarism: toolStats.get("plagiarism_checker_used")?.daily.get(key) || 0,
        citation: toolStats.get("citation_generator_used")?.daily.get(key) || 0,
      });
    }

    const data = [
      {
        tool: "Paraphrasing Assistant",
        eventName: "paraphrasing_tool_used",
        totalUses: toolStats.get("paraphrasing_tool_used")?.totalUses || 0,
        uniqueUsers: toolStats.get("paraphrasing_tool_used")?.uniqueUsers.size || 0,
        avgWordCount: toolStats.get("paraphrasing_tool_used")?.avgWordCount || 0,
      },
      {
        tool: "Plagiarism Checker",
        eventName: "plagiarism_checker_used",
        totalUses: toolStats.get("plagiarism_checker_used")?.totalUses || 0,
        uniqueUsers: toolStats.get("plagiarism_checker_used")?.uniqueUsers.size || 0,
        avgWordCount: toolStats.get("plagiarism_checker_used")?.avgWordCount || 0,
      },
      {
        tool: "Citation Generator",
        eventName: "citation_generator_used",
        totalUses: toolStats.get("citation_generator_used")?.totalUses || 0,
        uniqueUsers: toolStats.get("citation_generator_used")?.uniqueUsers.size || 0,
        avgWordCount: toolStats.get("citation_generator_used")?.avgWordCount || 0,
      },
    ];

    res.json({
      success: true,
      data: {
        data,
        dailySeries,
        period,
      },
    });
  } catch (error: any) {
    logger.error("Analytics free tools error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
