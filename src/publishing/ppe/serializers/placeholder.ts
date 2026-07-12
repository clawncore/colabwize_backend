/**
 * Builds the `placeholderLabels` map consumed by the serializers.
 *
 * Given the cross-reference index and a profile-specific formatter, produce a
 * `Record<internalId, token>` so that e.g. a Nature manuscript emits
 * `[Insert Figure 2 near here]` while a generic one emits `<<FIGURE_002>>`.
 */
import type { CrossReferenceIndex } from "../types";

export type PlaceholderKind = "figure" | "table" | "equation";
export type PlaceholderFormatter = (
  kind: PlaceholderKind,
  displayNumber: string,
) => string;

export function buildPlaceholderLabels(
  index: CrossReferenceIndex,
  fmt: PlaceholderFormatter,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const e of index.figures) map[e.internalId] = fmt("figure", e.displayNumber);
  for (const e of index.tables) map[e.internalId] = fmt("table", e.displayNumber);
  for (const e of index.equations) map[e.internalId] = fmt("equation", e.displayNumber);
  return map;
}

/**
 * Default placeholder style: `Figure 1 here` / `Table 2 here`. A plain,
 * human-readable callout that survives as text in the manuscript when a
 * figure/table is separated into its own file.
 */
export const defaultPlaceholderFormatter: PlaceholderFormatter = (
  _kind,
  displayNumber,
) => `${displayNumber} here`;
