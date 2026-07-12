/**
 * Publication Export Engine — public surface.
 *
 * Re-exports the PPE types, the stable-id assigner, the cross-reference indexer,
 * asset extraction + quality checks, the publisher-profile registry, the
 * package builder, and the submission-package output adapter.
 */
export * from "./types";
export * from "./ids";
export * from "./xref";
export * from "./assets";
export * from "./quality";
export * from "./profiles";
export * from "./serializers/placeholder";
export * from "./package";
export * from "./adapter";
