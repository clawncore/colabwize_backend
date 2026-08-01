import logger from "../../../monitoring/logger";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

interface SyncLog {
  id: string;
  service: string;
  status: SyncStatus;
  message: string;
  timestamp: string;
}

class IntegrationSyncService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private syncLogs: SyncLog[] = [];
  private cacheDurationMs: number;

  constructor() {
    const durationSec = parseInt(process.env.CACHE_DURATION || '600', 10);
    this.cacheDurationMs = durationSec * 1000;
  }

  /**
   * Retrieves data from the cache if it's still valid.
   */
  public getCachedData<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.cacheDurationMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  /**
   * Saves data to the cache.
   */
  public setCachedData<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Invalidates a specific cache key or all cache if no key provided.
   */
  public invalidateCache(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Logs a synchronization event.
   */
  public logSync(service: string, status: SyncStatus, message: string): void {
    const log: SyncLog = {
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
      logger.error(`[SyncService] ${service} - ${message}`);
    } else {
      logger.info(`[SyncService] ${service} - ${message}`);
    }
  }

  /**
   * Retrieves recent sync logs for a specific service or all services.
   */
  public getSyncLogs(service?: string): SyncLog[] {
    if (service) {
      return this.syncLogs.filter(log => log.service === service);
    }
    return this.syncLogs;
  }
}

export const syncService = new IntegrationSyncService();
