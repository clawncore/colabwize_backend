/**
 * Publisher profiles.
 *
 * Each profile encodes a target venue's submission rules so the UI can offer
 * one-click formatting: citation style, where figures/tables live, expected
 * image format + minimum DPI, color-space requirement, running title / cover
 * page, and the placeholder wording used when objects are pulled out of the
 * manuscript. This is the "exceptional" differentiator — users pick a journal
 * instead of hand-configuring every export setting.
 */
import type { CslStyle } from "../cdm";
import type { ImageFormat, PlacementMode } from "./types";
import {
  defaultPlaceholderFormatter,
  type PlaceholderFormatter,
} from "./serializers/placeholder";

export interface PublisherProfile {
  id: string;
  label: string;
  cslStyle: CslStyle;
  figurePlacement: PlacementMode;
  tablePlacement: PlacementMode;
  imageFormat: ImageFormat;
  allowedImageFormats: ImageFormat[];
  dpi: number;
  requireCmyk: boolean;
  runningTitle: boolean;
  coverPage: boolean;
  placeholderStyle: PlaceholderFormatter;
  columnLayout: 1 | 2;
}

export interface PublisherProfileInfo {
  id: string;
  label: string;
  cslStyle: CslStyle;
  dpi: number;
  figurePlacement: PlacementMode;
  tablePlacement: PlacementMode;
  imageFormat: ImageFormat;
}

const NEAR_HERE: PlaceholderFormatter = (_kind, displayNumber) =>
  `[Insert ${displayNumber} near here]`;
const PLAIN: PlaceholderFormatter = (_kind, displayNumber) => displayNumber;

const ALL_FORMATS: ImageFormat[] = [
  "png",
  "tiff",
  "jpg",
  "jpeg",
  "svg",
  "pdf",
];

function defineProfile(p: Partial<PublisherProfile> & { id: string; label: string }): PublisherProfile {
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
    placeholderStyle: defaultPlaceholderFormatter,
    columnLayout: 1,
    ...p,
  };
}

export const PUBLISHER_PROFILES: Record<string, PublisherProfile> = {
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

export function getPublisherProfile(id?: string): PublisherProfile {
  if (id && PUBLISHER_PROFILES[id]) return PUBLISHER_PROFILES[id];
  return PUBLISHER_PROFILES.generic;
}

export function listPublisherProfiles(): PublisherProfileInfo[] {
  return Object.values(PUBLISHER_PROFILES).map((p) => ({
    id: p.id,
    label: p.label,
    cslStyle: p.cslStyle,
    dpi: p.dpi,
    figurePlacement: p.figurePlacement,
    tablePlacement: p.tablePlacement,
    imageFormat: p.imageFormat,
  }));
}
