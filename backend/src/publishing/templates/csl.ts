import { normalizeToCSL, type CSLItem } from "../../utils/cslNormalization";

/**
 * CSL style registry — the "migrate CSL engine in" step of Phase 4.
 *
 * The existing `cslNormalization.ts` already knows how to normalise reference
 * data for Pandoc citeproc. Here we centralise the *available styles* (the CSL
 * files shipped under `src/assets/csl`) so templates and the export pipeline
 * share one source of truth, instead of the legacy code passing a free-form
 * `citationStyle` string that `PandocExportService` ignored (gap T5).
 */

export const BUILTIN_CSL_STYLES = ["apa", "mla", "chicago", "ieee"] as const;
export type BuiltinCslStyle = (typeof BUILTIN_CSL_STYLES)[number];

export interface CslStyleInfo {
  id: string;
  label: string;
  /** Bundled CSL file name under src/assets/csl, if any. */
  file?: string;
}

const STYLE_FILES: Record<string, string> = {
  apa: "apa.csl",
  mla: "mla.csl",
  chicago: "chicago.csl",
  ieee: "ieee.csl",
};

const STYLE_LABELS: Record<string, string> = {
  apa: "APA (American Psychological Association)",
  mla: "MLA (Modern Language Association)",
  chicago: "Chicago",
  ieee: "IEEE",
};

export function listCslStyles(): CslStyleInfo[] {
  return BUILTIN_CSL_STYLES.map((id) => ({
    id,
    label: STYLE_LABELS[id] ?? id.toUpperCase(),
    file: STYLE_FILES[id],
  }));
}

export function getCslStyleFile(name: string): string | undefined {
  return STYLE_FILES[name];
}

/** Re-export the existing normaliser so the whole platform uses one impl. */
export function normalizeReference(input: unknown): CSLItem {
  return normalizeToCSL(input);
}

export const normalizeCsl = normalizeToCSL;
