/**
 * Structural types for TipTap / ProseMirror JSON documents.
 *
 * These are intentionally minimal (input contract only) — the importer does not
 * depend on the `@tiptap/*` runtime, keeping the CDM module pure and unit-testable.
 */

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
}

export interface TiptapDoc {
  type: "doc";
  content: TiptapNode[];
}

export function isTiptapDoc(value: unknown): value is TiptapDoc {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: string }).type === "doc" &&
    Array.isArray((value as { content?: unknown }).content)
  );
}
