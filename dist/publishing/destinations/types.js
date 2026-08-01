"use strict";
/**
 * Phase 5 — Destination Adapters.
 *
 * A `DestinationAdapter` knows how to deliver a finished export artifact to a
 * single destination (local download, a cloud drive, a repository, an archive,
 * …). The export job processor resolves the requested destination by name from
 * a `DestinationRegistry` and pushes the artifact bytes after they are stored.
 *
 * Every adapter is injected (no hard SDK dependency), so the job lifecycle is
 * unit-tested without real cloud credentials. New providers (Dropbox/Box/
 * Overleaf/GitHub/Zenodo) are added by implementing this one interface — the
 * processor and billing lifecycle are unchanged (Strangler-Fig seam).
 */
Object.defineProperty(exports, "__esModule", { value: true });
