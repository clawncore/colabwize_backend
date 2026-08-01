"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPublicIp = getPublicIp;
exports.getLocationFromIp = getLocationFromIp;
async function getPublicIp() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch("https://api.ipify.org?format=json", {
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!response.ok)
            return null;
        const data = await response.json();
        return data.ip || null;
    }
    catch {
        return null;
    }
}
function isLocalhost(ip) {
    return !ip || ip === "127.0.0.1" || ip === "::1" || ip === "unknown" || ip === "localhost" ||
        ip.startsWith("10.") ||
        ip.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}
async function getLocationFromIp(ip) {
    if (isLocalhost(ip)) {
        return getLocationFromExternalService();
    }
    const result = await fetchLocationFromIpApiCo(ip);
    if (result)
        return result;
    const fallback = await fetchLocationFromIpApiCom(ip);
    if (fallback)
        return fallback;
    return "Unknown";
}
async function fetchLocationFromIpApiCo(ip) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const url = ip ? `https://ipapi.co/${ip}/json/` : "https://ipapi.co/json/";
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
        });
        clearTimeout(timeout);
        if (!response.ok)
            return null;
        const data = await response.json();
        if (data.country_name) {
            const parts = [data.city, data.region, data.country_name].filter(Boolean);
            return parts.join(", ");
        }
        return null;
    }
    catch {
        return null;
    }
}
async function fetchLocationFromIpApiCom(ip) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        let url = "https://ip-api.com/json/?fields=city,regionName,countryName,lat,lon";
        if (ip && !isLocalhost(ip)) {
            url = `https://ip-api.com/json/${ip}?fields=city,regionName,countryName,lat,lon`;
        }
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
        });
        clearTimeout(timeout);
        if (!response.ok)
            return null;
        const data = await response.json();
        if (data.country) {
            const parts = [data.city, data.region, data.country].filter(Boolean);
            return parts.join(", ");
        }
        return null;
    }
    catch {
        return null;
    }
}
async function getLocationFromExternalService() {
    try {
        const result = await fetchLocationFromIpApiCo("");
        if (result)
            return result;
    }
    catch {
        // Fall through
    }
    try {
        const result = await fetchLocationFromIpApiCom();
        if (result)
            return result;
    }
    catch {
        // Fall through
    }
    return "Unknown";
}
