interface GeoResult {
  city: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
}

interface IpApiResponse {
  city: string;
  region: string;
  country_name: string;
  lat: number;
  lon: number;
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
  return !ip || ip === "127.0.0.1" || ip === "::1" || ip === "unknown" || ip === "localhost";
}

export async function getLocationFromIp(ip: string): Promise<string> {
  if (isLocalhost(ip)) {
    return getLocationFromExternalService();
  }

  const result = await fetchLocationFromIpApiCo(ip);
  if (result) return result;

  const fallback = await fetchLocationFromIpApiCom(ip);
  if (fallback) return fallback;

  return "Unknown";
}

async function fetchLocationFromIpApiCo(ip: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const url = ip ? `https://ipapi.co/${ip}/json/` : "https://ipapi.co/json/";
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data: IpApiResponse = await response.json();

    if (data.country_name) {
      const parts = [data.city, data.region, data.country_name].filter(Boolean);
      return parts.join(", ");
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchLocationFromIpApiCom(ip?: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let url = "http://ip-api.com/json/?fields=city,regionName,countryName,lat,lon";
    if (ip && !isLocalhost(ip)) {
      url = `http://ip-api.com/json/${ip}?fields=city,regionName,countryName,lat,lon`;
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data: GeoResult = await response.json();

    if (data.country) {
      const parts = [data.city, data.region, data.country].filter(Boolean);
      return parts.join(", ");
    }

    return null;
  } catch {
    return null;
  }
}

async function getLocationFromExternalService(): Promise<string> {
  try {
    const result = await fetchLocationFromIpApiCo("");
    if (result) return result;
  } catch {
    // Fall through
  }

  try {
    const result = await fetchLocationFromIpApiCom();
    if (result) return result;
  } catch {
    // Fall through
  }

  return "Unknown";
}
