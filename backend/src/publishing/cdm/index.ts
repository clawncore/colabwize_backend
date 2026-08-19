/**
 * Canonical Document Model — public surface.
 *
 * Phase 1 of the Publishing Platform (see docs/PUBLISHING_PLATFORM_ARCHITECTURE_PLAN.md).
 * Later phases (Engine, Adapters, Job System) build on these pure, dependency-free
 * primitives.
 */
export * from "./types";
export * from "./tiptap";
export * from "./schema";
export { tiptapToCdm } from "./tiptapImporter";
export { cdmToTiptap } from "./cdmExporter";
