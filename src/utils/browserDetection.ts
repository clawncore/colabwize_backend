export interface BrowserInfo {
  browser: string;
  version: string;
  engine: string;
}

export interface DeviceInfo {
  deviceType: "Desktop" | "Mobile" | "Tablet";
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

export interface OsInfo {
  os: string;
  version: string;
}

export interface SessionData {
  device: string;
  browser: string;
  deviceType: string;
  ip: string;
  location: string;
}

export function detectBrowser(userAgent: string): BrowserInfo {
  const ua = userAgent;

  if (ua.includes("Edg/")) {
    const match = ua.match(/Edg\/(\d+)/);
    return {
      browser: "Edge",
      version: match ? match[1] : "",
      engine: "Blink",
    };
  }

  if (ua.includes("OPR/") || ua.includes("Opera")) {
    const match = ua.match(/OPR\/(\d+)/);
    return {
      browser: "Opera",
      version: match ? match[1] : "",
      engine: "Blink",
    };
  }

  if (ua.includes("Brave")) {
    const match = ua.match(/Chrome\/(\d+)/);
    return {
      browser: "Brave",
      version: match ? match[1] : "",
      engine: "Blink",
    };
  }

  if (ua.includes("Vivaldi")) {
    const match = ua.match(/Vivaldi\/(\d+)/);
    return {
      browser: "Vivaldi",
      version: match ? match[1] : "",
      engine: "Blink",
    };
  }

  if (ua.includes("Yandex")) {
    const match = ua.match(/YandexBrowser\/(\d+)/);
    return {
      browser: "Yandex Browser",
      version: match ? match[1] : "",
      engine: "Blink",
    };
  }

  if (ua.includes("Firefox")) {
    const match = ua.match(/Firefox\/(\d+)/);
    return {
      browser: "Firefox",
      version: match ? match[1] : "",
      engine: "Gecko",
    };
  }

  if (ua.includes("Chrome")) {
    const match = ua.match(/Chrome\/(\d+)/);
    return {
      browser: "Chrome",
      version: match ? match[1] : "",
      engine: "Blink",
    };
  }

  if (ua.includes("Safari")) {
    const match = ua.match(/Version\/(\d+)/);
    return {
      browser: "Safari",
      version: match ? match[1] : "",
      engine: "WebKit",
    };
  }

  return { browser: "Unknown", version: "", engine: "Unknown" };
}

export function detectDeviceType(userAgent: string): DeviceInfo {
  const ua = userAgent.toLowerCase();

  const isMobile =
    /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
      ua,
    ) &&
    !ua.includes("tablet") &&
    !ua.includes("ipad");

  const isTablet =
    /ipad|tablet|kindle|silk|playbook/i.test(ua) ||
    (ua.includes("android") && !ua.includes("mobile"));

  return {
    deviceType: isTablet ? "Tablet" : isMobile ? "Mobile" : "Desktop",
    isMobile,
    isTablet,
    isDesktop: !isMobile && !isTablet,
  };
}

export function detectOS(userAgent: string): OsInfo {
  const ua = userAgent;

  if (/windows nt 10/i.test(ua)) return { os: "Windows", version: "10" };
  if (/windows nt 6\.3/i.test(ua)) return { os: "Windows", version: "8.1" };
  if (/windows nt 6\.2/i.test(ua)) return { os: "Windows", version: "8" };
  if (/windows nt 6\.1/i.test(ua)) return { os: "Windows", version: "7" };
  if (/mac os x (\d+[._]\d+)/i.test(ua)) {
    const match = ua.match(/mac os x (\d+[._]\d+)/i);
    return { os: "macOS", version: match ? match[1].replace("_", ".") : "" };
  }
  if (/iphone|ipad|ipod/i.test(ua)) return { os: "iOS", version: "" };
  if (/android (\d+)/i.test(ua)) {
    const match = ua.match(/android (\d+)/i);
    return { os: "Android", version: match ? match[1] : "" };
  }
  if (/linux/i.test(ua)) return { os: "Linux", version: "" };
  if (/cros/i.test(ua)) return { os: "ChromeOS", version: "" };

  return { os: "Unknown", version: "" };
}

export function getDeviceLabel(userAgent: string): string {
  const browser = detectBrowser(userAgent);
  const device = detectDeviceType(userAgent);
  const os = detectOS(userAgent);
  const osLabel = os.os !== "Unknown" ? `${os.os} ${os.version}`.trim() : device.deviceType;
  return `${osLabel} - ${browser.browser}`;
}

export function formatIpAddress(xForwardedFor: string | null, directIp: string): string {
  if (xForwardedFor) {
    // A proxy chain appends hops, so the client is the FIRST entry.
    const firstIp = xForwardedFor.split(",")[0]?.trim();
    const normalized = normalizeIp(firstIp);
    if (normalized) {
      return normalized;
    }
  }
  const normalizedDirect = normalizeIp(directIp);
  return normalizedDirect ?? directIp ?? "";
}

/**
 * True when the address is a loopback address in either IPv4 or IPv6 form.
 * Used to decide whether we must resolve this server's public IP instead.
 */
export function isLoopbackAddress(ip: string): boolean {
  if (!ip) return true;
  const candidate = normalizeIp(ip);
  if (!candidate) return true;
  if (candidate === "127.0.0.1" || candidate === "::1") return true;
  if (candidate.startsWith("127.")) return true;
  // IPv4-mapped loopback already normalized above, but keep the check explicit.
  return /^::(?:ffff:)?127\./i.test(ip);
}

/**
 * Normalizes an address for storage and geolocation lookups.
 *
 * Node reports IPv4 peers in IPv4-mapped IPv6 form ("::ffff:203.0.113.45").
 * Those addresses contain dots, so a plain IPv6 character-class test rejects
 * them and we end up storing an empty IP. Strip the mapping prefix so
 * geolocation providers receive a plain IPv4 address.
 *
 * Returns null when the input is not a usable IP.
 */
function normalizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;

  // Strip brackets from "[::1]:3000" style entries.
  let candidate = trimmed;
  const bracketMatch = candidate.match(/^\[(.+)\](?::\d+)?$/);
  if (bracketMatch) {
    candidate = bracketMatch[1];
  }

  // IPv4-mapped IPv6 (::ffff:1.2.3.4) and IPv4-compatible (::1.2.3.4).
  const mapped = candidate.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mapped) {
    return isValidIpv4(mapped[1]) ? mapped[1] : null;
  }

  if (isValidIpv4(candidate)) {
    return candidate;
  }

  if (isValidIpv6(candidate)) {
    return candidate;
  }

  return null;
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith("0")) return false;
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

function isValidIpv6(ip: string): boolean {
  // Must contain at least one colon and only hex digits/colons.
  if (!ip.includes(":")) return false;
  if (!/^[0-9a-fA-F:]+$/.test(ip)) return false;
  // Reject the loose "::::" style matches the previous regex allowed.
  if (/:{4,}/.test(ip)) return false;
  if (ip.startsWith(":") && !ip.startsWith("::")) return false;
  if (ip.endsWith(":") && !ip.endsWith("::")) return false;
  return true;
}