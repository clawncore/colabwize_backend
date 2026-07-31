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
    const firstIp = xForwardedFor.split(",")[0]?.trim();
    if (firstIp && isValidIp(firstIp)) {
      return firstIp;
    }
  }
  return directIp;
}

function isValidIp(ip: string): boolean {
  const ipv4Pattern =
    /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?:\.|$)){4}$/;
  const ipv6Pattern = /^[0-9a-fA-F:]+$/;
  return ipv4Pattern.test(ip) || ipv6Pattern.test(ip);
}