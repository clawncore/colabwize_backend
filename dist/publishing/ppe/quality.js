"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkImageQuality = checkImageQuality;
function checkImageQuality(asset, profile) {
    const findings = [];
    const locator = { kind: "asset", id: asset.id };
    if (!asset.bytes) {
        findings.push({
            severity: "warning",
            code: "ASSET_UNRESOLVED",
            message: `Figure "${asset.id}" image could not be extracted (${asset.warnings.join("; ") || "unknown reason"}).`,
            locator,
        });
        return findings;
    }
    if (asset.warnings.length) {
        findings.push({
            severity: "info",
            code: "ASSET_WARNING",
            message: `Figure "${asset.id}": ${asset.warnings.join("; ")}`,
            locator,
        });
    }
    if (profile.dpi &&
        asset.dpi !== undefined &&
        asset.dpi > 0 &&
        asset.dpi < profile.dpi) {
        findings.push({
            severity: "warning",
            code: "LOW_RESOLUTION",
            message: `Figure "${asset.id}" is ${asset.dpi} dpi, below the ${profile.dpi} dpi required by ${profile.label}.`,
            locator,
        });
    }
    if (profile.allowedImageFormats.length && asset.ext) {
        if (!profile.allowedImageFormats.includes(asset.ext)) {
            findings.push({
                severity: "warning",
                code: "IMAGE_FORMAT_NOT_ALLOWED",
                message: `Figure "${asset.id}" is .${asset.ext}, but ${profile.label} expects ${profile.allowedImageFormats
                    .map((f) => `.${f}`)
                    .join(" / ")}.`,
                locator,
            });
        }
    }
    if (profile.requireCmyk) {
        if (asset.colorSpace === "rgb") {
            findings.push({
                severity: "warning",
                code: "REQUIRES_CMYK",
                message: `Figure "${asset.id}" appears to be RGB; ${profile.label} requires CMYK.`,
                locator,
            });
        }
        else if (asset.colorSpace === "unknown") {
            findings.push({
                severity: "info",
                code: "COLORSPACE_UNKNOWN",
                message: `Figure "${asset.id}" color space could not be determined; verify CMYK compliance manually.`,
                locator,
            });
        }
    }
    return findings;
}
