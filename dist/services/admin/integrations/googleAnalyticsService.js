"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.gaService = void 0;
const googleapis_1 = require("googleapis");
const syncService_1 = require("./syncService");
const logger_1 = __importDefault(require("../../../monitoring/logger"));
const fs_1 = __importDefault(require("fs"));
class GoogleAnalyticsService {
    analyticsDataClient;
    propertyId;
    isConfigured;
    constructor() {
        this.propertyId = process.env.GOOGLE_ANALYTICS_PROPERTY_ID || '';
        this.isConfigured = !!(this.propertyId && process.env.GOOGLE_APPLICATION_CREDENTIALS);
        this.initClient();
    }
    initClient() {
        if (!this.isConfigured)
            return;
        try {
            const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
            if (!fs_1.default.existsSync(credPath)) {
                logger_1.default.warn(`[GA4] Credentials file not found at ${credPath}`);
                this.isConfigured = false;
                return;
            }
            const auth = new googleapis_1.google.auth.GoogleAuth({
                scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
                keyFile: credPath,
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
    /**
     * Re-checks env vars and re-initializes client if config changed.
     * Call this before making API requests to handle server restarts.
     */
    ensureConfigured() {
        const propId = process.env.GOOGLE_ANALYTICS_PROPERTY_ID || '';
        const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
        const shouldBeConfigured = !!(propId && credPath);
        if (shouldBeConfigured && !this.isConfigured) {
            logger_1.default.info("[GA4] Configuration detected, re-initializing client");
            this.propertyId = propId;
            this.isConfigured = true;
            this.initClient();
        }
        else if (!shouldBeConfigured && this.isConfigured) {
            logger_1.default.warn("[GA4] Configuration removed, disabling client");
            this.isConfigured = false;
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
        this.ensureConfigured();
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
    async getDailyTraffic(days = 30) {
        return this.runReport(['date'], ['activeUsers', 'newUsers', 'sessions', 'screenPageViews'], [{ startDate: `${days}daysAgo`, endDate: 'today' }]);
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
