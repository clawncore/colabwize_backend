"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncService = void 0;
const logger_1 = __importDefault(require("../../../monitoring/logger"));
class IntegrationSyncService {
    cache = new Map();
    syncLogs = [];
    cacheDurationMs;
    constructor() {
        const durationSec = parseInt(process.env.CACHE_DURATION || '600', 10);
        this.cacheDurationMs = durationSec * 1000;
    }
    /**
     * Retrieves data from the cache if it's still valid.
     */
    getCachedData(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return null;
        if (Date.now() - entry.timestamp > this.cacheDurationMs) {
            this.cache.delete(key);
            return null;
        }
        return entry.data;
    }
    /**
     * Saves data to the cache.
     */
    setCachedData(key, data) {
        this.cache.set(key, { data, timestamp: Date.now() });
    }
    /**
     * Invalidates a specific cache key or all cache if no key provided.
     */
    invalidateCache(key) {
        if (key) {
            this.cache.delete(key);
        }
        else {
            this.cache.clear();
        }
    }
    /**
     * Logs a synchronization event.
     */
    logSync(service, status, message) {
        const log = {
            id: Math.random().toString(36).substring(2, 9),
            service,
            status,
            message,
            timestamp: new Date().toISOString(),
        };
        this.syncLogs.unshift(log);
        // Keep only the last 100 logs in memory
        if (this.syncLogs.length > 100) {
            this.syncLogs.pop();
        }
        if (status === 'error') {
            logger_1.default.error(`[SyncService] ${service} - ${message}`);
        }
        else {
            logger_1.default.info(`[SyncService] ${service} - ${message}`);
        }
    }
    /**
     * Retrieves recent sync logs for a specific service or all services.
     */
    getSyncLogs(service) {
        if (service) {
            return this.syncLogs.filter(log => log.service === service);
        }
        return this.syncLogs;
    }
}
exports.syncService = new IntegrationSyncService();
