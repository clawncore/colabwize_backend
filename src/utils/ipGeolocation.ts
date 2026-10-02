/**
 * IP geolocation for login history, active sessions, and security emails.
 *
 * Provider notes (verified by live probe):
 *  - ipapi.co   : HTTPS, good data, but the free tier rate-limits aggressively
 *                 and answers 429 once you exceed it. Treated as "try next".
 *  - ip-api.com : the free endpoint is HTTP-ONLY. Calling it over HTTPS returns
 *                 403 Forbidden with an empty body, so we must use http://.
 *
 * Field names differ between the two providers and are easy to mix up:
 *  - ipapi.co   -> { city, region, country_name }
 *  - ip-api.com -> { city, regionName, country }
 *
 * Because both providers are free-tier and rate-limited, results are cached
 * per-IP for CACHE_TTL_MS so repeat logins do not burn the quota.
 */

import logger from "../monitoring/logger";

/** Shape returned by ipapi.co. */
interface IpApiCoResponse {
  city?: string;
  region?: string;
  country_name?: string;
  error?: boolean;
  reason?: string;
}

/** Shape returned by ip-api.com (note: regionName / country, not region / country_name). */
interface IpApiComResponse {
  status?: string;
  city?: string;
  regionName?: string;
  country?: string;
  message?: string;
}

const REQUEST_TIMEOUT_MS = 5000;

/** Cache successful lookups for 24h. Failures are cached far more briefly. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  location: string;
  expiresAt: number;
}

const locationCache = new Map<string, CacheEntry>();

/** Keeps the cache from growing without bound on long-lived processes. */
const MAX_CACHE_ENTRIES = 5000;

function readCache(ip: string): string | null {
  const entry = locationCache.get(ip);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    locationCache.delete(ip);
    return null;
  }

  // Refresh LRU position.
  locationCache.delete(ip);
  locationCache.set(ip, entry);
  return entry.location;
}

function writeCache(ip: string, location: string, ttl: number): void {
  if (locationCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = locationCache.keys().next().value;
    if (oldestKey !== undefined) {
      locationCache.delete(oldestKey);
    }
  }
  locationCache.set(ip, { location, expiresAt: Date.now() + ttl });
}

export function clearLocationCache(): void {
  locationCache.clear();
  ipApiCoDisabledUntil = 0;
}

/**
 * Circuit breaker for ipapi.co.
 *
 * ipapi.co's free tier answers 429 for the whole server IP once the daily
 * quota is spent, and the limit is not per-request-retryable. Without this,
 * every login would burn a doomed HTTPS request before reaching the working
 * fallback. Once we see a 429 we stop calling it for CIRCUIT_BREAKER_MS.
 */
const CIRCUIT_BREAKER_MS = 10 * 60 * 1000;
let ipApiCoDisabledUntil = 0;

function isIpApiCoDisabled(): boolean {
  return Date.now() < ipApiCoDisabledUntil;
}

function tripIpApiCoBreaker(): void {
  if (ipApiCoDisabledUntil === 0) {
    logger.warn(
      "ipapi.co rate limited: bypassing provider for the next " +
        `${CIRCUIT_BREAKER_MS / 1000}s and using ip-api.com`,
    );
  }
  ipApiCoDisabledUntil = Date.now() + CIRCUIT_BREAKER_MS;
}

export async function getPublicIp(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch("https://api.ipify.org?format=json", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data: { ip: string } = await response.json();
    return data.ip || null;
  } catch {
    return null;
  }
}

function isLocalhost(ip: string): boolean {
  if (!ip) return true;

  const normalized = ip.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "unknown" || normalized === "localhost") return true;

  // IPv4-mapped IPv6 loopback / private ranges, e.g. "::ffff:127.0.0.1".
  const mapped = normalized.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  const candidate = mapped ? mapped[1] : normalized;

  if (candidate === "::1" || candidate === "127.0.0.1") return true;
  if (candidate === "::") return true;

  // RFC1918 private ranges.
  if (candidate.startsWith("10.")) return true;
  if (candidate.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(candidate)) return true;
  // Carrier-grade NAT.
  if (candidate.startsWith("100.64.")) return true;

  // Link-local and unique-local IPv6.
  if (/^fe[89ab]/.test(candidate)) return true;

  return false;
}

export async function getLocationFromIp(ip: string): Promise<string> {
  if (isLocalhost(ip)) {
    return getLocationFromExternalService();
  }

  const cached = readCache(ip);
  if (cached) return cached;

  // Primary provider (HTTPS). ipapi.co uses country_name.
  const primary = await fetchLocationFromIpApiCo(ip);
  if (primary) {
    writeCache(ip, primary, CACHE_TTL_MS);
    return primary;
  }

  // Fallback provider. ip-api.com is HTTP-only and uses country / regionName.
  const fallback = await fetchLocationFromIpApiCom(ip);
  if (fallback) {
    writeCache(ip, fallback, CACHE_TTL_MS);
    return fallback;
  }

  // Both providers failed. Cache briefly so we don't hammer them on every
  // request while they are rate limiting us.
  writeCache(ip, "Unknown", FAILURE_CACHE_TTL_MS);
  return "Unknown";
}

async function fetchLocationFromIpApiCo(ip: string): Promise<string | null> {
  // Skip entirely while the circuit is open rather than burning a request
  // that we already know will be answered with 429.
  if (isIpApiCoDisabled()) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const url = ip ? `https://ipapi.co/${ip}/json/` : "https://ipapi.co/json/";
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeout);

    if (response.status === 429) {
      // Free-tier quota exhausted for this server. Open the breaker and let
      // the caller fall through to ip-api.com.
      tripIpApiCoBreaker();
      logger.warn("ipapi.co rate limited", { ip, status: response.status });
      return null;
    }

    if (!response.ok) {
      logger.warn("ipapi.co lookup failed", { ip, status: response.status });
      return null;
    }

    const data: IpApiCoResponse = await response.json();

    if (data.error) {
      logger.warn("ipapi.co returned an error", { ip, reason: data.reason });
      return null;
    }

    const country = data.country_name;
    if (country) {
      const parts = [data.city, data.region, country].filter(Boolean);
      return parts.join(", ");
    }

    return null;
  } catch (error) {
    logger.warn("ipapi.co lookup threw", {
      ip,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function fetchLocationFromIpApiCom(ip?: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    // NOTE: the free ip-api.com endpoint does not support HTTPS. Requesting
    // https:// returns 403 Forbidden. Keep this on http://.
    const fields = "city,regionName,country,lat,lon";
    let url = `http://ip-api.com/json/?fields=${fields}`;
    if (ip && !isLocalhost(ip)) {
      url = `http://ip-api.com/json/${ip}?fields=${fields}`;
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn("ip-api.com lookup failed", {
        ip: ip ?? null,
        status: response.status,
        rateLimited: response.status === 429,
      });
      return null;
    }

    const data: IpApiComResponse = await response.json();

    if (data.status === "fail") {
      logger.warn("ip-api.com returned a failure", { ip, message: data.message });
      return null;
    }

    // ip-api.com returns `country` and `regionName`.
    const country = data.country;
    if (country) {
      const parts = [data.city, data.regionName, country].filter(Boolean);
      return parts.join(", ");
    }

    return null;
  } catch (error) {
    logger.warn("ip-api.com lookup threw", {
      ip: ip ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Cache key for "wherever this server egresses from". */
const SELF_LOOKUP_KEY = "__self__";

async function getLocationFromExternalService(): Promise<string> {
  // This path resolves the server's own egress IP, so the answer barely ever
  // changes. Cache it like any other lookup to avoid burning quota per login.
  const cached = readCache(SELF_LOOKUP_KEY);
  if (cached) return cached;

  let result: string | null = null;

  try {
    result = await fetchLocationFromIpApiCo("");
    if (result) {
      writeCache(SELF_LOOKUP_KEY, result, CACHE_TTL_MS);
      return result;
    }
  } catch {
    // Fall through
  }

  try {
    result = await fetchLocationFromIpApiCom();
    if (result) {
      writeCache(SELF_LOOKUP_KEY, result, CACHE_TTL_MS);
      return result;
    }
  } catch {
    // Fall through
  }

  writeCache(SELF_LOOKUP_KEY, "Unknown", FAILURE_CACHE_TTL_MS);
  return "Unknown";
}
