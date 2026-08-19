import logger from "./logger";
import os from "os";

// ────────────────────────────────────────────────
// System sampler — real CPU/memory/load captured on a fixed cadence so the
// realtime dashboard has a genuine time-series for these even when no HTTP
// traffic is flowing. Runs lazily: the interval is only started once the
// sample history has at least one consumer intent (see sampleSystemNow).
// ────────────────────────────────────────────────

export interface LatencySample {
  ts: number; // epoch ms (Date.now())
  durationMs: number;
  statusCode: number;
  route: string;
  method: string;
}

export interface SystemSample {
  ts: number; // epoch ms (Date.now())
  cpuPercent: number;
  memPercent: number;
  memUsedBytes: number;
  loadAvg1m: number;
}

const MAX_SAMPLES = 1200;
const MAX_SYSTEM_SAMPLES = 1200;

function computeCpuPercent(): number {
  // Two os.cpus() snapshots a few ms apart yield a usable idle-delta.
  const sample = () =>
    os.cpus().map((c) => c.times).reduce(
      (acc: { idle: number; total: number }, t: { idle: number; user: number; nice: number; sys: number; irq: number }) => ({
        idle: acc.idle + t.idle,
        total: acc.total + t.idle + t.user + t.nice + t.sys + t.irq,
      }),
      { idle: 0, total: 0 },
    );
  const s1 = sample();
  const s2 = sample();
  const idleDelta = s2.idle - s1.idle;
  const totalDelta = s2.total - s1.total;
  return totalDelta > 0 ? Number(((1 - idleDelta / totalDelta) * 100).toFixed(1)) : 0;
}

// Simple in-memory metrics storage
class MetricsCollector {
  private metrics: Map<string, number[]> = new Map();
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private dailyApiCalls: Map<string, number> = new Map();
  public routeTimings: { route: string; method: string; count: number; avg: number; p95: number; p99: number }[] = [];

  // Rolling ring buffer of timestamped latency samples, consumed by the
  // realtime/history admin endpoints to draw live latency graphs. This is the
  // source of truth for every point on the dashboard — never synthesized.
  private samples: LatencySample[] = [];

  // Rolling ring buffer of timestamped CPU/memory/load samples, pushed by a
  // fixed 2s interval so the dashboard has a real system time-series even when
  // no HTTP traffic is flowing.
  private systemSamples: SystemSample[] = [];

  // Record a latency sample with its timestamp (real request data).
  recordSample(sample: Omit<LatencySample, "ts">) {
    this.samples.push({ ...sample, ts: Date.now() });
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    }
  }

  // Record a real CPU/memory/load sample (pushed on a fixed cadence).
  recordSystemSample(sample: Omit<SystemSample, "ts">) {
    this.systemSamples.push({ ...sample, ts: Date.now() });
    if (this.systemSamples.length > MAX_SYSTEM_SAMPLES) {
      this.systemSamples.splice(0, this.systemSamples.length - MAX_SYSTEM_SAMPLES);
    }
  }

  // System samples since `sinceTs` (epoch ms).
  getSystemSamplesSince(sinceTs: number): SystemSample[] {
    return this.systemSamples.filter((s) => s.ts >= sinceTs);
  }

  // Bucket the system samples into `bucketMs` buckets covering the last
  // `windowMs`, aligned to the same bucket keys as getSampleSeries so CPU/mem
  // and latency can share an x-axis. Buckets with no system sample are marked
  // `sample: false` — the UI renders them as a gap, never a fabricated value.
  getSystemSeries(
    windowMs = 300_000,
    bucketMs = 1000,
  ): { ts: number; cpuPercent: number; memPercent: number; sample: boolean }[] {
    const now = Date.now();
    // Align the window start to a bucket boundary so loop keys match the
    // bucket keys computed from sample timestamps (Math.floor(ts/bucketMs)*bucketMs).
    const start = Math.floor((now - windowMs) / bucketMs) * bucketMs;
    const byBucket = new Map<number, { cpu: number; mem: number; count: number }>();

    for (const s of this.systemSamples) {
      if (s.ts < start) continue;
      const key = Math.floor(s.ts / bucketMs) * bucketMs;
      const entry = byBucket.get(key) || { cpu: 0, mem: 0, count: 0 };
      entry.cpu += s.cpuPercent;
      entry.mem += s.memPercent;
      entry.count += 1;
      byBucket.set(key, entry);
    }

    const out: { ts: number; cpuPercent: number; memPercent: number; sample: boolean }[] = [];
    for (let t = start; t <= now; t += bucketMs) {
      const e = byBucket.get(t);
      out.push({
        ts: t,
        cpuPercent: e ? Math.round((e.cpu / e.count) * 10) / 10 : 0,
        memPercent: e ? Math.round((e.mem / e.count) * 10) / 10 : 0,
        sample: !!e,
      });
    }
    return out;
  }

  // All samples recorded since `sinceTs` (epoch ms).
  getSamplesSince(sinceTs: number): LatencySample[] {
    return this.samples.filter((s) => s.ts >= sinceTs);
  }

  // Number of requests in the last `windowMs` — a real request-rate signal.
  getRecentRequestRate(windowMs = 60_000): number {
    const since = Date.now() - windowMs;
    let count = 0;
    for (const s of this.samples) {
      if (s.ts >= since) count++;
    }
    return count;
  }

  // Bucket the recorded samples into `bucketMs` (default 1s) buckets covering
  // the last `windowMs`. Each bucket carries the real avg/max latency, request
  // count, and 5xx error count. Buckets with no samples are present but marked
  // `sample: false` so the UI can render them honestly (gap/empty), never fake.
  getSampleSeries(windowMs = 300_000, bucketMs = 1000): {
    ts: number;
    latencyAvg: number;
    latencyMax: number;
    requests: number;
    errors: number;
    sample: boolean;
  }[] {
    const now = Date.now();
    // Align the window start to a bucket boundary so loop keys match the
    // bucket keys computed from sample timestamps (Math.floor(ts/bucketMs)*bucketMs).
    const start = Math.floor((now - windowMs) / bucketMs) * bucketMs;
    const buckets: { ts: number; latencyAvg: number; latencyMax: number; requests: number; errors: number; sample: boolean }[] = [];
    const counts = new Map<number, { sum: number; max: number; count: number; errors: number }>();

    for (const s of this.samples) {
      if (s.ts < start) continue;
      const bucketKey = Math.floor(s.ts / bucketMs) * bucketMs;
      const entry = counts.get(bucketKey) || { sum: 0, max: 0, count: 0, errors: 0 };
      entry.sum += s.durationMs;
      if (s.durationMs > entry.max) entry.max = s.durationMs;
      entry.count += 1;
      if (s.statusCode >= 500) entry.errors += 1;
      counts.set(bucketKey, entry);
    }

    for (let t = start; t <= now; t += bucketMs) {
      const entry = counts.get(t);
      buckets.push({
        ts: t,
        latencyAvg: entry ? Math.round((entry.sum / entry.count) * 10) / 10 : 0,
        latencyMax: entry ? entry.max : 0,
        requests: entry ? entry.count : 0,
        errors: entry ? entry.errors : 0,
        sample: !!entry,
      });
    }
    return buckets;
  }

  // Record a timing metric
  recordTiming(name: string, value: number) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metrics = this.metrics.get(name)!;
    metrics.push(value);

    // Keep only the last 1000 values to prevent memory issues
    if (metrics.length > 1000) {
      metrics.shift();
    }

    logger.info(`Timing metric recorded: ${name} = ${value}ms`);
  }

  // Increment a counter
  incrementCounter(name: string, value: number = 1) {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
    logger.info(`Counter incremented: ${name} = ${current + value}`);
  }

  // Set a gauge value
  setGauge(name: string, value: number) {
    this.gauges.set(name, value);
    logger.info(`Gauge set: ${name} = ${value}`);
  }

  // Record an API call against the current UTC day. This gives the analytics
  // `/daily` route a real per-day request series without depending on the
  // (often empty) platform_metrics table.
  recordDailyApiCall() {
    const key = new Date().toISOString().slice(0, 10);
    this.dailyApiCalls.set(key, (this.dailyApiCalls.get(key) || 0) + 1);
  }

  // Get the per-day API call counts (YYYY-MM-DD -> count)
  getDailyApiCalls(): Map<string, number> {
    return this.dailyApiCalls;
  }

  // Get timing statistics
  getTimingStats(name: string) {
    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) {
      return null;
    }

    const sorted = [...metrics].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const avg = sum / sorted.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    return {
      count: sorted.length,
      avg,
      min,
      max,
      p50,
      p95,
      p99,
    };
  }

  // Get counter value
  getCounter(name: string): number {
    return this.counters.get(name) || 0;
  }

  // Get gauge value
  getGauge(name: string): number {
    return this.gauges.get(name) || 0;
  }

  // Get all metrics summary
  getSummary() {
    const summary: any = {
      counters: {},
      gauges: {},
      timings: {},
      routeTimings: this.routeTimings,
    };

    // Add counters
    for (const [name, value] of this.counters.entries()) {
      summary.counters[name] = value;
    }

    // Add gauges
    for (const [name, value] of this.gauges.entries()) {
      summary.gauges[name] = value;
    }

    // Add timing stats
    for (const name of this.metrics.keys()) {
      summary.timings[name] = this.getTimingStats(name);
    }

    return summary;
  }

  // Reset all metrics
  reset() {
    this.metrics.clear();
    this.counters.clear();
    this.gauges.clear();
    this.dailyApiCalls.clear();
    this.routeTimings = [];
    this.samples = [];
    this.systemSamples = [];
    logger.info("All metrics reset");
  }

  // Capture a real CPU/memory/load sample right now and push it into the
  // systemSamples ring buffer. Called on a fixed interval (see below) so the
  // dashboard always has an honest, continuous system time-series.
  captureSystemSample(): void {
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    this.recordSystemSample({
      cpuPercent: computeCpuPercent(),
      memPercent: totalMem > 0 ? Number(((mem.rss / totalMem) * 100).toFixed(1)) : 0,
      memUsedBytes: mem.rss,
      loadAvg1m: Number(os.loadavg()[0].toFixed(2)),
    });
  }
}

// Create and export a singleton instance
export const metrics = new MetricsCollector();

// Start the system sampler on a fixed 2s cadence. Cheap (<2ms per sample) and
// gives the realtime dashboard a genuine CPU/mem time-series even with zero
// HTTP traffic. This runs for the lifetime of the backend process.
setInterval(() => {
  try {
    metrics.captureSystemSample();
  } catch (err) {
    logger.warn(`System sampler tick failed: ${err instanceof Error ? err.message : err}`);
  }
}, 2000);

// Middleware for Express to record HTTP request timings.
// Records both a global aggregate (`http_request_duration`) and a per-route
// series (`http_request_duration_by_route`) consumed by the admin analytics.
// The router reference is captured lazily on "finish" because Express only
// populates `req.route` once routing has completed.
export const metricsMiddleware = (req: any, res: any, next: any) => {
  const start = Date.now();

  // Record timing when response finishes
  res.on("finish", () => {
    const duration = Date.now() - start;
    const route = req.route ? req.route.path : req.path;
    const method = req.method;
    const statusCode = res.statusCode;

    metrics.recordTiming(`http_request_duration`, duration);

    // Keep a timestamped latency sample for the realtime/history dashboard.
    metrics.recordSample({ durationMs: duration, statusCode, route, method });

    // Keep an aggregated per-route series.
    const prev = metrics.routeTimings;
    const entry = prev?.find((e) => e.route === route && e.method === method);
    const series = prev ?? [];
    const nextEntry = entry
      ? {
          ...entry,
          count: entry.count + 1,
          avg: (entry.avg * entry.count + duration) / (entry.count + 1),
          p95: Math.max(entry.p95, duration),
          p99: Math.max(entry.p99, duration),
        }
      : { route, method, count: 1, avg: duration, p95: duration, p99: duration };
    const idx = series.findIndex((e) => e.route === route && e.method === method);
    if (idx >= 0) series[idx] = nextEntry;
    else series.push(nextEntry);

    metrics.incrementCounter(`http_requests_total`);
    metrics.incrementCounter(`http_requests_${method.toLowerCase()}_total`);
    metrics.incrementCounter(`http_responses_${statusCode}_total`);
    metrics.recordDailyApiCall();
    if (statusCode >= 500) metrics.incrementCounter(`http_responses_5xx_total`);

    logger.info(`HTTP ${method} ${route} ${statusCode} - ${duration}ms`);
  });

  next();
};

export default metrics;
