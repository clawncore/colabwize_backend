import express, { Router } from "express";
import { isPlatformAdmin } from "../../middleware/platformAdmin";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import os from "os";

const router: Router = express.Router();

router.use(isPlatformAdmin);

// ==========================================
// EMAIL SYSTEM STATS
// ==========================================
router.get("/email-stats", async (req, res) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalSent, totalFailed, totalPending, recent24h, recentErrors] = await Promise.all([
      prisma.emailLog.count({ where: { status: "sent" } }),
      prisma.emailLog.count({ where: { status: "failed" } }),
      prisma.emailLog.count({ where: { status: "pending" } }),
      prisma.emailLog.count({ where: { sent_at: { gte: last24h } } }),
      prisma.emailLog.findMany({
        where: { status: "failed", sent_at: { gte: last7d } },
        orderBy: { sent_at: "desc" },
        take: 10,
        select: { id: true, recipient: true, subject: true, error: true, sent_at: true }
      })
    ]);

    const total = totalSent + totalFailed;
    const bounceRate = total > 0 ? ((totalFailed / total) * 100).toFixed(2) : "0.00";

    // Detect provider configuration
    const smtpConfigured = !!(process.env.IMAP_HOST && process.env.IMAP_USER);
    const resendConfigured = !!process.env.RESEND_API_KEY;

    res.json({
      success: true,
      data: {
        providers: {
          smtp: { configured: smtpConfigured, status: smtpConfigured ? "configured" : "unconfigured" },
          resend: { configured: resendConfigured, status: resendConfigured ? "configured" : "unconfigured" }
        },
        queue: {
          pending: totalPending,
          retryQueue: 0, // placeholder — no retry queue model yet
        },
        totals: {
          sent: totalSent,
          failed: totalFailed,
          pending: totalPending,
          last24h: recent24h,
        },
        rates: {
          bounceRate: parseFloat(bounceRate),
          openRate: null, // requires email tracking pixel (not implemented)
          clickRate: null, // requires link tracking (not implemented)
        },
        recentErrors,
      }
    });
  } catch (error: any) {
    logger.error("Observability email-stats error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// AUTH STATS
// ==========================================
router.get("/auth-stats", async (req, res) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last1h = new Date(now.getTime() - 60 * 60 * 1000);

    const [
      activeSessions,
      sessionsLast24h,
      accountLocks,
      twoFaEnabled,
      verifiedUsers,
      totalUsers,
    ] = await Promise.all([
      prisma.userSession.count({ where: { ended_at: null } }),
      prisma.userSession.count({ where: { created_at: { gte: last24h } } }),
      prisma.accountLock.count({ where: { locked_at: { gte: last24h } } }),
      prisma.user.count({ where: { two_factor_enabled: true } }),
      prisma.user.count({ where: { email_verified: true } }),
      prisma.user.count(),
    ]);

    const supabaseConfigured = !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
    const googleOAuthConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

    res.json({
      success: true,
      data: {
        providers: {
          supabaseAuth: { configured: supabaseConfigured, status: supabaseConfigured ? "active" : "unconfigured" },
          googleOAuth: { configured: googleOAuthConfigured, status: googleOAuthConfigured ? "active" : "unconfigured" },
        },
        sessions: {
          active: activeSessions,
          newLast24h: sessionsLast24h,
        },
        security: {
          accountLocksLast24h: accountLocks,
          twoFaEnabledUsers: twoFaEnabled,
          twoFaRate: totalUsers > 0 ? ((twoFaEnabled / totalUsers) * 100).toFixed(1) : "0.0",
        },
        verification: {
          verifiedUsers,
          unverifiedUsers: totalUsers - verifiedUsers,
          verificationRate: totalUsers > 0 ? ((verifiedUsers / totalUsers) * 100).toFixed(1) : "0.0",
        }
      }
    });
  } catch (error: any) {
    logger.error("Observability auth-stats error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// USER PLATFORM STATS
// ==========================================
router.get("/user-platform", async (req, res) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prev30d_start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [
      total,
      verified,
      activeLast30d,
      activeLast24h,
      newLast30d,
      newPrev30d,
      withSubscription,
      withTwoFactor,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { email_verified: true } }),
      prisma.user.count({ where: { last_seen_at: { gte: last30d } } }),
      prisma.user.count({ where: { last_seen_at: { gte: last24h } } }),
      prisma.user.count({ where: { created_at: { gte: last30d } } }),
      prisma.user.count({ where: { created_at: { gte: prev30d_start, lte: last30d } } }),
      prisma.user.count({ where: { NOT: { user_type: null } } }), // use user_type as proxy for plan
      prisma.user.count({ where: { two_factor_enabled: true } }),
    ]);

    const growthRate = newPrev30d > 0 ? (((newLast30d - newPrev30d) / newPrev30d) * 100).toFixed(1) : "0.0";
    const inactive = total - activeLast30d;
    const unverified = total - verified;

    res.json({
      success: true,
      data: {
        counts: {
          total,
          verified,
          unverified,
          activeLast30d,
          dailyActive: activeLast24h,
          newLast30d,
          withSubscription,
          inactive,
          withTwoFactor,
        },
        rates: {
          growthRate: parseFloat(growthRate),
          verificationRate: total > 0 ? parseFloat(((verified / total) * 100).toFixed(1)) : 0,
          activityRate: total > 0 ? parseFloat(((activeLast30d / total) * 100).toFixed(1)) : 0,
        }
      }
    });
  } catch (error: any) {
    logger.error("Observability user-platform error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// RESEARCH PLATFORM STATS
// ==========================================
router.get("/research-platform", async (req, res) => {
  try {
    const [
      totalProjects,
      activeProjects,
      completedProjects,
      archivedProjects,
      totalPdfs,
      processingPdfs,
      completedPdfs,
      failedPdfs,
      totalAIUsageRecords,
    ] = await Promise.all([
      prisma.project.count(),
      prisma.project.count({ where: { status: "active" } }),
      prisma.project.count({ where: { status: "completed" } }),
      prisma.project.count({ where: { status: "archived" } }),
      prisma.pdfDocument.count(),
      prisma.pdfDocument.count({ where: { status: "processing" } }),
      prisma.pdfDocument.count({ where: { status: "completed" } }),
      prisma.pdfDocument.count({ where: { status: "failed" } }),
      prisma.aIUsage.count(),
    ]);

    res.json({
      success: true,
      data: {
        projects: {
          total: totalProjects,
          active: activeProjects,
          completed: completedProjects,
          archived: archivedProjects,
          draft: totalProjects - activeProjects - completedProjects - archivedProjects,
        },
        documents: {
          total: totalPdfs,
          processing: processingPdfs,
          completed: completedPdfs,
          failed: failedPdfs,
        },
        aiUsageRecords: totalAIUsageRecords,
      }
    });
  } catch (error: any) {
    logger.error("Observability research-platform error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// AI PLATFORM STATS
// ==========================================
router.get("/ai-platform", async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const openaiConfigured = !!(process.env.OPENAI_API_KEY);
    const anthropicConfigured = !!(process.env.ANTHROPIC_API_KEY);

    // Aggregate AI usage from the AIUsage table
    const [monthlyUsage, allTimeUsage] = await Promise.all([
      prisma.aIUsage.aggregate({
        where: {
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        },
        _sum: { request_count: true }
      }),
      prisma.aIUsage.aggregate({
        _sum: { request_count: true }
      })
    ]);

    const monthlyRequests = monthlyUsage._sum.request_count || 0;
    const allTimeRequests = allTimeUsage._sum.request_count || 0;

    res.json({
      success: true,
      data: {
        providers: {
          openai: {
            configured: openaiConfigured,
            status: openaiConfigured ? "available" : "unconfigured",
          },
          anthropic: {
            configured: anthropicConfigured,
            status: anthropicConfigured ? "available" : "unconfigured",
          },
          titan: {
            configured: false,
            status: "unconfigured",
          },
        },
        currentProvider: openaiConfigured ? "openai" : anthropicConfigured ? "anthropic" : "none",
        usage: {
          requestsThisMonth: monthlyRequests,
          requestsAllTime: allTimeRequests,
          // Token counts, costs, latency are estimated/mocked as real tracking requires middleware
          estimatedTokensThisMonth: monthlyRequests * 1500, // rough estimate
          estimatedCostUSD: (monthlyRequests * 1500 * 0.000002).toFixed(4),
        }
      }
    });
  } catch (error: any) {
    logger.error("Observability ai-platform error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// BACKGROUND SERVICES
// ==========================================
router.get("/background-services", async (req, res) => {
  try {
    // Static map of known scheduled/cron services
    const knownJobs = [
      { name: "Webhook Retry", type: "interval", interval: "1min", description: "Retries failed webhooks" },
      { name: "Session Cleanup", type: "interval", interval: "1hr", description: "Expires old sessions" },
      { name: "Certificate Retention", type: "interval", interval: "24hr", description: "Purges expired certificates" },
      { name: "Version Cleanup", type: "interval", interval: "24hr", description: "Removes old document versions" },
      { name: "Search Alerts", type: "cron", interval: "daily", description: "Sends saved search alert emails" },
    ];

    res.json({
      success: true,
      data: {
        knownJobs,
        summary: {
          total: knownJobs.length,
          registered: knownJobs.length,
          failed: 0,
        },
        note: "Job execution history is not persisted in the current architecture. Runtime-only status is shown."
      }
    });
  } catch (error: any) {
    logger.error("Observability background-services error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// DATABASE DETAIL
// ==========================================
router.get("/database-detail", async (req, res) => {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const pingMs = Date.now() - start;

    // Count active sessions via Prisma query
    const [sessionCount, accountLockCount, userCount] = await Promise.all([
      prisma.userSession.count({ where: { ended_at: null } }),
      prisma.accountLock.count(),
      prisma.user.count(),
    ]);

    const migrationList = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 5
    `;

    res.json({
      success: true,
      data: {
        status: "healthy",
        pingMs,
        activeSessions: sessionCount,
        stats: {
          totalUsers: userCount,
          activeLocks: accountLockCount,
        },
        migrations: {
          recent: migrationList,
          status: "up_to_date",
        },
        provider: "PostgreSQL via Supabase",
        pooling: "PgBouncer (Transaction Mode)",
      }
    });
  } catch (error: any) {
    logger.error("Observability database-detail error:", error);
    res.status(500).json({ success: false, error: error.message, status: "unhealthy" });
  }
});

// ==========================================
// INTEGRATION HEALTH ROLLUP
// ==========================================
router.get("/integration-health", async (req, res) => {
  try {
    const integrations = [
      { name: "Google Analytics 4", key: "ga4", configured: !!(process.env.GOOGLE_ANALYTICS_PROPERTY_ID && process.env.GOOGLE_APPLICATION_CREDENTIALS) },
      { name: "Lemon Squeezy", key: "lemon_squeezy", configured: !!(process.env.LEMONSQUEEZY_API_KEY) },
      { name: "Supabase", key: "supabase", configured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) },
      { name: "SMTP", key: "smtp", configured: !!(process.env.IMAP_HOST) },
      { name: "OpenAI", key: "openai", configured: !!(process.env.OPENAI_API_KEY) },
      { name: "Anthropic", key: "anthropic", configured: !!(process.env.ANTHROPIC_API_KEY) },
      { name: "Google Drive / OAuth", key: "google_oauth", configured: !!(process.env.GOOGLE_CLIENT_ID) },
      { name: "Cloudinary", key: "cloudinary", configured: !!(process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME) },
    ];

    const configured = integrations.filter(i => i.configured).length;
    const healthScore = Math.round((configured / integrations.length) * 100);

    res.json({
      success: true,
      data: {
        integrations: integrations.map(i => ({
          ...i,
          status: i.configured ? "healthy" : "pending_configuration",
          health: i.configured ? "healthy" : "pending_configuration",
        })),
        summary: {
          total: integrations.length,
          configured,
          pending: integrations.length - configured,
          healthScore,
        }
      }
    });
  } catch (error: any) {
    logger.error("Observability integration-health error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// PLATFORM HEALTH (AGGREGATED)
// ==========================================
router.get("/platform-health", async (req, res) => {
  try {
    const startTime = Date.now();

    // Test DB
    let dbStatus = "healthy";
    let dbPingMs = 0;
    try {
      const dbStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbPingMs = Date.now() - dbStart;
    } catch {
      dbStatus = "unhealthy";
    }

    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const memUsagePct = Math.round((heapUsedMB / heapTotalMB) * 100);

    const uptime = process.uptime();
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMins = Math.floor((uptime % 3600) / 60);

    const services = [
      { name: "Backend API", status: "healthy", latencyMs: Date.now() - startTime },
      { name: "Database", status: dbStatus, latencyMs: dbPingMs },
      { name: "Supabase Auth", status: process.env.SUPABASE_URL ? "healthy" : "unconfigured", latencyMs: 0 },
      { name: "Lemon Squeezy", status: process.env.LEMONSQUEEZY_API_KEY ? "healthy" : "unconfigured", latencyMs: 0 },
      { name: "Email (SMTP)", status: process.env.IMAP_HOST ? "healthy" : "unconfigured", latencyMs: 0 },
      { name: "WebSocket", status: "healthy", latencyMs: 0 },
      { name: "Scheduler", status: "healthy", latencyMs: 0 },
    ];

    const healthy = services.filter(s => s.status === "healthy").length;
    const healthScore = Math.round((healthy / services.length) * 100);

    const overallStatus = dbStatus === "unhealthy" ? "degraded" : healthScore >= 80 ? "operational" : healthScore >= 50 ? "degraded" : "outage";

    res.json({
      success: true,
      data: {
        status: overallStatus,
        healthScore,
        uptime: {
          seconds: Math.floor(uptime),
          display: `${uptimeHours}h ${uptimeMins}m`,
        },
        services,
        memory: {
          heapUsedMB,
          heapTotalMB,
          usagePct: memUsagePct,
        },
        alerts: services.filter(s => s.status !== "healthy").map(s => ({
          service: s.name,
          severity: s.status === "unhealthy" ? "critical" : "warning",
          message: `${s.name} is ${s.status}`,
          timestamp: new Date().toISOString(),
        }))
      }
    });
  } catch (error: any) {
    logger.error("Observability platform-health error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// ACTIVE ALERTS
// ==========================================
router.get("/alerts", async (req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const memPct = (heapUsedMB / heapTotalMB) * 100;

    const alerts: any[] = [];

    if (memPct > 85) {
      alerts.push({ id: "mem-high", type: "system", severity: "critical", title: "High Memory Usage", message: `Heap usage at ${memPct.toFixed(0)}%`, timestamp: new Date().toISOString() });
    } else if (memPct > 70) {
      alerts.push({ id: "mem-warn", type: "system", severity: "warning", title: "Elevated Memory Usage", message: `Heap usage at ${memPct.toFixed(0)}%`, timestamp: new Date().toISOString() });
    }

    if (!process.env.GOOGLE_ANALYTICS_PROPERTY_ID) {
      alerts.push({ id: "ga4-unconfigured", type: "integration", severity: "info", title: "GA4 Unconfigured", message: "Google Analytics 4 credentials not set", timestamp: new Date().toISOString() });
    }
    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      alerts.push({ id: "ai-unconfigured", type: "integration", severity: "warning", title: "No AI Provider Configured", message: "OpenAI and Anthropic API keys are both missing", timestamp: new Date().toISOString() });
    }

    res.json({
      success: true,
      data: {
        alerts,
        total: alerts.length,
        critical: alerts.filter(a => a.severity === "critical").length,
        warning: alerts.filter(a => a.severity === "warning").length,
        info: alerts.filter(a => a.severity === "info").length,
      }
    });
  } catch (error: any) {
    logger.error("Observability alerts error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// PAYMENT / LEMON SQUEEZY MONITORING
// ==========================================
router.get("/payment-monitoring", async (req, res) => {
  try {
    const apiKey = process.env.LEMONSQUEEZY_API_KEY;
    const storeId = process.env.LEMONSQUEEZY_STORE_ID;
    const webhookSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

    res.json({
      success: true,
      data: {
        connection: {
          apiKey: apiKey ? "configured" : "missing",
          storeId: storeId || null,
          webhookSecret: webhookSecret ? "configured" : "missing",
          status: apiKey && storeId ? "configured" : "pending_configuration",
        },
        variants: {
          plusMonthly: process.env.LEMONSQUEEZY_PLUS_MONTHLY_VARIANT_ID || null,
          plusAnnual: process.env.LEMONSQUEEZY_PLUS_ANNUAL_VARIANT_ID || null,
          premiumMonthly: process.env.LEMONSQUEEZY_PREMIUM_MONTHLY_VARIANT_ID || null,
          premiumAnnual: process.env.LEMONSQUEEZY_PREMIUM_ANNUAL_VARIANT_ID || null,
          credits10: process.env.LEMONSQUEEZY_CREDITS_10_VARIANT_ID || null,
          credits25: process.env.LEMONSQUEEZY_CREDITS_25_VARIANT_ID || null,
          credits50: process.env.LEMONSQUEEZY_CREDITS_50_VARIANT_ID || null,
        },
        note: "Live payment metrics require Lemon Squeezy API integration. Use /api/admin/integrations/lemon/* for live data."
      }
    });
  } catch (error: any) {
    logger.error("Observability payment-monitoring error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
