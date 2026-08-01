"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lemonSqueezyService = void 0;
const axios_1 = __importDefault(require("axios"));
const syncService_1 = require("./syncService");
class LemonSqueezyService {
    client;
    isConfigured;
    storeId;
    constructor() {
        const apiKey = process.env.LEMON_SQUEEZY_API_KEY;
        this.storeId = process.env.LEMON_SQUEEZY_STORE_ID || '';
        this.isConfigured = !!(apiKey && this.storeId);
        this.client = axios_1.default.create({
            baseURL: 'https://api.lemonsqueezy.com/v1',
            headers: {
                'Accept': 'application/vnd.api+json',
                'Content-Type': 'application/vnd.api+json',
                'Authorization': `Bearer ${apiKey || 'unconfigured'}`
            },
            timeout: 10000,
        });
    }
    getStatus() {
        return {
            service: 'Lemon Squeezy',
            isConfigured: this.isConfigured,
            health: this.isConfigured ? 'healthy' : 'pending_configuration',
            lastSync: syncService_1.syncService.getSyncLogs('lemon_squeezy')[0]?.timestamp || null,
            storeId: this.storeId || null
        };
    }
    async fetchAllPages(endpoint, params = {}) {
        if (!this.isConfigured) {
            throw new Error("Lemon Squeezy is not configured. Missing API Key or Store ID.");
        }
        const cacheKey = `ls_${endpoint}_${JSON.stringify(params)}`;
        const cached = syncService_1.syncService.getCachedData(cacheKey);
        if (cached)
            return cached;
        try {
            let results = [];
            let url = endpoint;
            let currentParams = { ...params };
            while (url) {
                const response = await this.client.get(url, { params: currentParams });
                results = results.concat(response.data.data);
                if (response.data.links && response.data.links.next) {
                    url = response.data.links.next;
                    currentParams = {}; // Links usually contain the query params
                }
                else {
                    url = '';
                }
            }
            syncService_1.syncService.setCachedData(cacheKey, results);
            syncService_1.syncService.logSync('lemon_squeezy', 'success', `Fetched ${results.length} items from ${endpoint}`);
            return results;
        }
        catch (error) {
            syncService_1.syncService.logSync('lemon_squeezy', 'error', `API Error on ${endpoint}: ${error.message}`);
            throw error;
        }
    }
    async getOrders() {
        return this.fetchAllPages('/orders', { 'filter[store_id]': this.storeId });
    }
    async getCustomers() {
        return this.fetchAllPages('/customers', { 'filter[store_id]': this.storeId });
    }
    async getSubscriptions() {
        return this.fetchAllPages('/subscriptions', { 'filter[store_id]': this.storeId });
    }
    async getProducts() {
        return this.fetchAllPages('/products', { 'filter[store_id]': this.storeId });
    }
    async getLicenses() {
        return this.fetchAllPages('/license-keys', { 'filter[store_id]': this.storeId });
    }
    async getRevenueMetrics() {
        // A complex aggregation would happen here or we just return raw orders/subscriptions for the frontend to aggregate
        // But since the API doesn't have a direct /revenue endpoint that gives MRR over time easily without aggregation,
        // we'll fetch orders and subscriptions and calculate high-level stats.
        if (!this.isConfigured) {
            throw new Error("Lemon Squeezy is not configured.");
        }
        try {
            // In a real scenario we'd do a time-bound fetch. 
            // For this implementation, we return a structural placeholder representing the aggregation logic
            return {
                totalRevenue: 0,
                mrr: 0,
                arr: 0,
                refunds: 0,
                taxes: 0
            };
        }
        catch (error) {
            throw error;
        }
    }
}
exports.lemonSqueezyService = new LemonSqueezyService();
