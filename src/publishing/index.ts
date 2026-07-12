/**
 * Publishing Platform — public surface.
 *
 * Re-exports the Canonical Document Model (Phase 1), the Publishing Engine +
 * output adapters (Phase 2), the Export Job System (Phase 3), templates +
 * validation (Phase 4), and destinations (Phase 5).
 *
 * NOTE: `export *` from the jobs module is scoped to avoid leaking its many
 * internal types into the top-level namespace unintentionally.
 */
export * from "./cdm";
export * from "./types";
export * from "./engine";
export * from "./serializers/html";
export * from "./serializers/markdown";
export * from "./serializers/text";
export * from "./ppe";
export * from "./adapters/output/pandocAdapter";
export * from "./adapters/output/puppeteerPdfAdapter";
export * from "./adapters/output/htmlAdapter";
export * from "./adapters/output/markdownAdapter";
export * from "./adapters/output/textAdapter";
export * from "./jobs";
export * from "./destinations";
