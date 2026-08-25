import { syncService } from "./syncService";
import logger from "../../../monitoring/logger";

/**
 * RenderService — reads the Render Management API (https://api.render.com/v1)
 * to surface REAL production telemetry: service status/config, live CPU/memory/
 * HTTP-latency time series, and deploy history.
 *
 * Auth: `Authorization: Bearer <RENDER_API_KEY>` — a Render API key created in
 * Render Dashboard → Account Settings → API Keys. When the key is missing every
 * method reports `unconfigured` rather than fabricating values.
 *
 * Metric shapes (verified against api-docs.render.com):
 *   GET /v1/services?limit=N → { serviceList: [{ service, cursor }] }
 *   GET /metrics/cpu|memory|http-latency?startTime&endTime&resolutionSeconds&resource&aggregationMethod
 *     → [ { labels: [{field,value}], values: [{timestamp, value}], unit } ]
 *   GET /v1/deploys?serviceId=… → { deploys: [{ deploy: { id, status, commit, startedAt, finishedAt, createdAt }, cursor }] }
 */

const RENDER_API_BASE = "https://api.render.com/v1";

export type RenderMetric = "cpu" | "memory" | "http-latency" | "http-requests" | "instance-count";

export interface RenderMetricPoint {
  timestamp: string; // ISO date-time
  value: number;
}

export interface RenderMetricSeries {
  labels: { field: string; value: string }[];
  values: RenderMetricPoint[];
  unit: string;
}

export interface RenderServiceInfo {
  id: string;
  name: string;
  type: string;
  branch: string | null;
  repo: string | null;
  slug: string;
  suspended: "suspended" | "not_suspended";
  plan: string | null;
  region: string | null;
  numInstances: number;
  healthCheckPath: string | null;
  url: string | null;
  runtime: string | null;
  createdAt: string | null;
}

export interface RenderDeployInfo {
  id: string;
  status: string;
  commitMessage: string | null;
  commitId: string | null;
  createdAt: string | null;
  finishedAt: string | null;
}

class RenderService {
  private isConfigured: boolean;

  constructor() {
    this.isConfigured = !!process.env.RENDER_API_KEY;
  }

  /** True only when RENDER_API_KEY is set. */
  private ensureConfigured() {
    const shouldBe = !!process.env.RENDER_API_KEY;
    if (shouldBe && !this.isConfigured) {
      logger.info("[Render] API key detected, enabling");
      this.isConfigured = true;
    } else if (!shouldBe && this.isConfigured) {
      logger.warn("[Render] API key removed, disabling");
      this.isConfigured = false;
    }
  }

  public getStatus() {
    this.ensureConfigured();
    return {
      service: "Render",
      isConfigured: this.isConfigured,
      health: this.isConfigured ? "healthy" : "pending_configuration",
      lastSync: syncService.getSyncLogs("render")[0]?.timestamp || null,
    };
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${process.env.RENDER_API_KEY}`,
      "Content-Type": "application/json",
    };
  }

  private async fetchJson<T>(path: string, params?: Record<string, string>): Promise<T> {
    this.ensureConfigured();
    if (!this.isConfigured) {
      throw new Error("Render is not configured. Missing RENDER_API_KEY.");
    }
    const url = new URL(`${RENDER_API_BASE}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url.toString(), { headers: this.authHeaders() });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Render API ${path} failed: ${res.status} ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  /** List all services in the workspace. */
  public async listServices(limit = 100): Promise<RenderServiceInfo[]> {
    const cacheKey = `render_services`;
    const cached = syncService.getCachedData<RenderServiceInfo[]>(cacheKey);
    if (cached) return cached;

    const data = await this.fetchJson<{ serviceList?: { service: any; cursor?: string }[] }>(
      "/v1/services",
      { limit: String(limit) },
    );
    const services = (data.serviceList || []).map((s) => this.normalizeService(s.service));
    syncService.setCachedData(cacheKey, services);
    syncService.logSync("render", "success", `Fetched ${services.length} services`);
    return services;
  }

  private normalizeService(svc: any): RenderServiceInfo {
    const details = svc?.serviceDetails || {};
    const envDetails = details?.envSpecificDetails || {};
    return {
      id: svc?.id || "",
      name: svc?.name || "unnamed",
      type: svc?.type || "web_service",
      branch: svc?.branch || null,
      repo: svc?.repo || null,
      slug: svc?.slug || "",
      suspended: svc?.suspended === "suspended" ? "suspended" : "not_suspended",
      plan: details?.plan || details?.buildPlan || null,
      region: details?.region || null,
      numInstances: Number(details?.numInstances) || 1,
      healthCheckPath: details?.healthCheckPath || null,
      url: details?.url || null,
      runtime: details?.runtime || details?.env || envDetails?.runtime || null,
      createdAt: svc?.createdAt || null,
    };
  }

  /**
   * Fetch a live metric time series for one or more resources.
   * Render metrics are min-30s resolution; request at least a 5m window.
   */
  public async getMetric(
    metric: RenderMetric,
    resource: string,
    opts: { startTime?: string; endTime?: string; resolutionSeconds?: number; aggregationMethod?: "AVG" | "MAX" | "MIN" } = {},
  ): Promise<RenderMetricSeries[]> {
    this.ensureConfigured();
    if (!this.isConfigured) throw new Error("Render is not configured. Missing RENDER_API_KEY.");

    const path = `/metrics/${metric}`;
    const params: Record<string, string> = {
      resource,
      ...(opts.startTime ? { startTime: opts.startTime } : {}),
      ...(opts.endTime ? { endTime: opts.endTime } : {}),
      ...(opts.resolutionSeconds ? { resolutionSeconds: String(opts.resolutionSeconds) } : {}),
      ...(opts.aggregationMethod ? { aggregationMethod: opts.aggregationMethod } : {}),
    };
    if (metric === "http-latency") {
      // HTTP latency is quantile-driven (e.g. p99 = 0.99)
      params.quantile = "0.99";
    }

    const cacheKey = `render_metric_${metric}_${resource}_${params.startTime}_${params.endTime}_${params.resolutionSeconds}`;
    const cached = syncService.getCachedData<RenderMetricSeries[]>(cacheKey);
    if (cached) return cached;

    const data = await this.fetchJson<RenderMetricSeries[]>(path, params);
    syncService.setCachedData(cacheKey, data);
    syncService.logSync("render", "success", `Fetched ${metric} metric`);
    return data;
  }

  /** List deploys for a service (most recent first). */
  public async listDeploys(serviceId: string, limit = 5): Promise<RenderDeployInfo[]> {
    const cacheKey = `render_deploys_${serviceId}`;
    const cached = syncService.getCachedData<RenderDeployInfo[]>(cacheKey);
    if (cached) return cached;

    const data = await this.fetchJson<{ deploys?: { deploy: any; cursor?: string }[] }>(
      "/v1/deploys",
      { serviceId, limit: String(limit) },
    );
    const deploys = (data.deploys || []).map((d) => {
      const deploy = d.deploy || {};
      return {
        id: deploy?.id || "",
        status: deploy?.status || "unknown",
        commitMessage: deploy?.commit?.message || null,
        commitId: deploy?.commit?.id || null,
        createdAt: deploy?.createdAt || null,
        finishedAt: deploy?.finishedAt || null,
      } as RenderDeployInfo;
    });
    syncService.setCachedData(cacheKey, deploys);
    syncService.logSync("render", "success", `Fetched ${deploys.length} deploys`);
    return deploys;
  }
}

export const renderService = new RenderService();
export default renderService;
