"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUBLISHER_PROFILES = void 0;
exports.getPublisherProfile = getPublisherProfile;
exports.listPublisherProfiles = listPublisherProfiles;
const placeholder_1 = require("./serializers/placeholder");
const NEAR_HERE = (_kind, displayNumber) => `[Insert ${displayNumber} near here]`;
const PLAIN = (_kind, displayNumber) => displayNumber;
const ALL_FORMATS = [
    "png",
    "tiff",
    "jpg",
    "jpeg",
    "svg",
    "pdf",
];
function defineProfile(p) {
    return {
        cslStyle: "apa",
        // Default to true separation so every export cleanly splits the manuscript
        // from its figures/tables/images unless a profile overrides it.
        figurePlacement: "separate-doc",
        tablePlacement: "separate-doc",
        imageFormat: "png",
        allowedImageFormats: ALL_FORMATS,
        dpi: 300,
        requireCmyk: false,
        runningTitle: false,
        coverPage: false,
        placeholderStyle: placeholder_1.defaultPlaceholderFormatter,
        columnLayout: 1,
        ...p,
    };
}
exports.PUBLISHER_PROFILES = {
    generic: defineProfile({ id: "generic", label: "Generic / Custom" }),
    nature: defineProfile({
        id: "nature",
        label: "Nature",
        cslStyle: "nature",
        figurePlacement: "end",
        tablePlacement: "separate-doc",
        imageFormat: "tiff",
        allowedImageFormats: ["tiff", "tiff"],
        dpi: 600,
        runningTitle: true,
        coverPage: true,
        placeholderStyle: NEAR_HERE,
    }),
    ieee: defineProfile({
        id: "ieee",
        label: "IEEE",
        cslStyle: "ieee",
        figurePlacement: "inline",
        tablePlacement: "inline",
        imageFormat: "pdf",
        allowedImageFormats: ["pdf", "pdf", "png", "jpg", "jpeg"],
        dpi: 600,
        columnLayout: 2,
        coverPage: true,
        placeholderStyle: PLAIN,
    }),
    elsevier: defineProfile({
        id: "elsevier",
        label: "Elsevier",
        cslStyle: "elsevier",
        figurePlacement: "end",
        tablePlacement: "inline",
        imageFormat: "tiff",
        allowedImageFormats: ["tiff", "tiff", "pdf", "png", "jpg", "jpeg"],
        dpi: 300,
        runningTitle: true,
        placeholderStyle: NEAR_HERE,
    }),
    custom: defineProfile({ id: "custom", label: "Custom" }),
};
function getPublisherProfile(id) {
    if (id && exports.PUBLISHER_PROFILES[id])
        return exports.PUBLISHER_PROFILES[id];
    return exports.PUBLISHER_PROFILES.generic;
}
function listPublisherProfiles() {
    return Object.values(exports.PUBLISHER_PROFILES).map((p) => ({
        id: p.id,
        label: p.label,
        cslStyle: p.cslStyle,
        dpi: p.dpi,
        figurePlacement: p.figurePlacement,
        tablePlacement: p.tablePlacement,
        imageFormat: p.imageFormat,
    }));
}
