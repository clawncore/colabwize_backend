import { google } from "googleapis";
import { syncService } from "./syncService";
import logger from "../../../monitoring/logger";

class GoogleAnalyticsService {
  private analyticsDataClient: any;
  private propertyId: string;
  private isConfigured: boolean;

  constructor() {
    this.propertyId = process.env.GOOGLE_ANALYTICS_PROPERTY_ID || '';
    
    // In Google Cloud environments, GOOGLE_APPLICATION_CREDENTIALS automatically configures Auth.
    // If not set, or if propertyId is empty, we mark it as unconfigured.
    this.isConfigured = !!(this.propertyId && process.env.GOOGLE_APPLICATION_CREDENTIALS);

    if (this.isConfigured) {
      try {
        const auth = new google.auth.GoogleAuth({
          scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
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
}

export const gaService = new GoogleAnalyticsService();
