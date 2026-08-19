import { google } from "googleapis";
import { syncService } from "./syncService";
import logger from "../../../monitoring/logger";
import fs from "fs";

class GoogleAnalyticsService {
  private analyticsDataClient: any;
  private propertyId: string;
  private isConfigured: boolean;

  constructor() {
    this.propertyId = process.env.GOOGLE_ANALYTICS_PROPERTY_ID || '';
    this.isConfigured = !!(this.propertyId && process.env.GOOGLE_APPLICATION_CREDENTIALS);
    this.initClient();
  }

  private initClient() {
    if (!this.isConfigured) return;
    try {
      const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
      if (!fs.existsSync(credPath)) {
        logger.warn(`[GA4] Credentials file not found at ${credPath}`);
        this.isConfigured = false;
        return;
      }
      const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
        keyFile: credPath,
      });
      this.analyticsDataClient = google.analyticsdata({
        version: 'v1beta',
        auth: auth,
      });
    } catch (err) {
      logger.error("Failed to initialize Google Analytics Client", err);
      this.isConfigured = false;
    }
  }

  /**
   * Re-checks env vars and re-initializes client if config changed.
   * Call this before making API requests to handle server restarts.
   */
  private ensureConfigured() {
    const propId = process.env.GOOGLE_ANALYTICS_PROPERTY_ID || '';
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
    const shouldBeConfigured = !!(propId && credPath);

    if (shouldBeConfigured && !this.isConfigured) {
      logger.info("[GA4] Configuration detected, re-initializing client");
      this.propertyId = propId;
      this.isConfigured = true;
      this.initClient();
    } else if (!shouldBeConfigured && this.isConfigured) {
      logger.warn("[GA4] Configuration removed, disabling client");
      this.isConfigured = false;
    }
  }

  public getStatus() {
    return {
      service: 'Google Analytics 4',
      isConfigured: this.isConfigured,
      health: this.isConfigured ? 'healthy' : 'pending_configuration',
      lastSync: syncService.getSyncLogs('google_analytics')[0]?.timestamp || null,
      propertyId: this.propertyId ? `properties/${this.propertyId.substring(0, 4)}...` : null
    };
  }

  public async runReport(dimensions: string[], metrics: string[], dateRanges: { startDate: string, endDate: string }[] = [{ startDate: '30daysAgo', endDate: 'today' }]) {
    this.ensureConfigured();
    if (!this.isConfigured) {
      throw new Error("Google Analytics is not configured. Missing credentials or Property ID.");
    }

    const cacheKey = `ga4_${dimensions.join('_')}_${metrics.join('_')}_${dateRanges[0].startDate}_${dateRanges[0].endDate}`;
    const cached = syncService.getCachedData(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.analyticsDataClient.properties.runReport({
        property: `properties/${this.propertyId}`,
        requestBody: {
          dateRanges,
          dimensions: dimensions.map(name => ({ name })),
          metrics: metrics.map(name => ({ name }))
        }
      });
      
      syncService.setCachedData(cacheKey, response.data);
      syncService.logSync('google_analytics', 'success', `Fetched ${metrics.join(', ')}`);
      
      return response.data;
    } catch (error: any) {
      syncService.logSync('google_analytics', 'error', `API Error: ${error.message}`);
      throw error;
    }
  }

  public async getTrafficOverview() {
    return this.runReport(
      ['sessionSourceMedium'], 
      ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'averageSessionDuration', 'bounceRate']
    );
  }

  public async getDailyTraffic(days = 30) {
    return this.runReport(
      ['date'],
      ['activeUsers', 'newUsers', 'sessions', 'screenPageViews'],
      [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    );
  }

  public async getGeography() {
    return this.runReport(['country', 'city'], ['activeUsers']);
  }

  public async getPages() {
    return this.runReport(['pagePath'], ['screenPageViews', 'activeUsers']);
  }

  public async getDevices() {
    return this.runReport(['deviceCategory', 'operatingSystem', 'browser'], ['activeUsers']);
  }

  public async getEvents() {
    return this.runReport(['eventName'], ['eventCount', 'activeUsers']);
  }

  /**
   * Fetch per-page-path screen views. Returns the raw rows keyed by pagePath.
   * Defensive: returns [] when GA4 is not configured so callers never 500.
   */
  public async getPageViewsByPath(days = 30): Promise<{ pagePath: string; views: number }[]> {
    try {
      const response = await this.runReport(
        ['pagePath'],
        ['screenPageViews'],
        [{ startDate: `${days}daysAgo`, endDate: 'today' }],
      );
      const rows = response?.rows || [];
      return rows
        .map((r: any) => ({
          pagePath: r.dimensionValues?.[0]?.value || '',
          views: Number(r.metricValues?.[0]?.value) || 0,
        }))
        .filter((r: { pagePath: string }) => r.pagePath);
    } catch (err: any) {
      logger.warn(`[GA4] getPageViewsByPath failed (returning empty): ${err.message}`);
      return [];
    }
  }
}

export const gaService = new GoogleAnalyticsService();
