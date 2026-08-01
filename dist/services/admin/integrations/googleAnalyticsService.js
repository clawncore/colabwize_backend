"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.gaService = void 0;
const googleapis_1 = require("googleapis");
const syncService_1 = require("./syncService");
const logger_1 = __importDefault(require("../../../monitoring/logger"));
class GoogleAnalyticsService {
    analyticsDataClient;
    propertyId;
    isConfigured;
    constructor() {
        this.propertyId = process.env.GOOGLE_ANALYTICS_PROPERTY_ID || '';
        // In Google Cloud environments, GOOGLE_APPLICATION_CREDENTIALS automatically configures Auth.
        // If not set, or if propertyId is empty, we mark it as unconfigured.
        this.isConfigured = !!(this.propertyId && process.env.GOOGLE_APPLICATION_CREDENTIALS);
        if (this.isConfigured) {
            try {
                const auth = new googleapis_1.google.auth.GoogleAuth({
                    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
                });
                this.analyticsDataClient = googleapis_1.google.analyticsdata({
                    version: 'v1beta',
                    auth: auth,
                });
            }
            catch (err) {
                logger_1.default.error("Failed to initialize Google Analytics Client", err);
                this.isConfigured = false;
            }
        }
    }
    getStatus() {
        return {
            service: 'Google Analytics 4',
            isConfigured: this.isConfigured,
            health: this.isConfigured ? 'healthy' : 'pending_configuration',
            lastSync: syncService_1.syncService.getSyncLogs('google_analytics')[0]?.timestamp || null,
            propertyId: this.propertyId ? `properties/${this.propertyId.substring(0, 4)}...` : null
        };
    }
    async runReport(dimensions, metrics, dateRanges = [{ startDate: '30daysAgo', endDate: 'today' }]) {
        if (!this.isConfigured) {
            throw new Error("Google Analytics is not configured. Missing credentials or Property ID.");
        }
        const cacheKey = `ga4_${dimensions.join('_')}_${metrics.join('_')}_${dateRanges[0].startDate}_${dateRanges[0].endDate}`;
        const cached = syncService_1.syncService.getCachedData(cacheKey);
        if (cached)
            return cached;
        try {
            const response = await this.analyticsDataClient.properties.runReport({
                property: `properties/${this.propertyId}`,
                requestBody: {
                    dateRanges,
                    dimensions: dimensions.map(name => ({ name })),
                    metrics: metrics.map(name => ({ name }))
                }
            });
            syncService_1.syncService.setCachedData(cacheKey, response.data);
            syncService_1.syncService.logSync('google_analytics', 'success', `Fetched ${metrics.join(', ')}`);
            return response.data;
        }
        catch (error) {
            syncService_1.syncService.logSync('google_analytics', 'error', `API Error: ${error.message}`);
            throw error;
        }
    }
    async getTrafficOverview() {
        return this.runReport(['sessionSourceMedium'], ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'averageSessionDuration', 'bounceRate']);
    }
    async getGeography() {
        return this.runReport(['country', 'city'], ['activeUsers']);
    }
    async getPages() {
        return this.runReport(['pagePath'], ['screenPageViews', 'activeUsers']);
    }
    async getDevices() {
        return this.runReport(['deviceCategory', 'operatingSystem', 'browser'], ['activeUsers']);
    }
    async getEvents() {
        return this.runReport(['eventName'], ['eventCount', 'activeUsers']);
    }
}
exports.gaService = new GoogleAnalyticsService();
