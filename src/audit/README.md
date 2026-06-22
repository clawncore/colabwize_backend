# Citation Audit Architecture

This folder owns the editor-facing citation audit pipeline used by:

- `POST /api/audit/start`
- `GET /api/audit/progress/:auditId`
- `backend/src/audit/pipeline.ts`

It is currently the authoritative path for live document audits because it accepts the full editor document state, extracts citations and references directly from ProseMirror JSON, streams progress, and returns the same `AuditReport` shape consumed by the audit sidebar and report panel.

## Current pipeline

`pipeline.ts` creates an in-memory `AuditJob`, then runs these stages in order:

1. `EXTRACTION` — extracts inline citations, bibliography entries, and structured citation IDs from editor JSON.
2. `DB_VERIFICATION` — matches citations to references and verifies pairs through `services/citationAudit/externalVerification.ts`.
3. `DUPLICATE_DETECTION` — detects duplicate bibliography entries.
4. `URL_VALIDATION` — validates reference URLs and DOI links.
5. `STYLE_CHECK` — checks style-specific inline and bibliography formatting.
6. `SCORE` — calculates the final compliance score and report summary.

Stage failures are captured as audit issues so large or messy documents can still return partial results.

## Other audit layers

There are two overlapping audit surfaces outside this folder:

- `backend/src/api/citations/audit.ts` (`POST /api/citations/audit`)
  - Synchronous citation audit endpoint.
  - Performs style checks, matching, verification, duplicate detection, and scoring independently.
  - Uses manual Supabase auth and subscription checks.
  - Duplicates much of the pipeline logic and returns a similar but not identical `AuditReport`.

- `backend/src/api/citations/forensic-audit.ts` (`POST /api/citations/forensic-audit`)
  - Authenticated forensic audit endpoint.
  - Accepts pre-built citation pairs and delegates to `ForensicAuditService`.
  - Useful as a narrower forensic layer, but should not remain the primary editor audit flow.

## Known architecture gaps

1. **Duplicate audit ownership**
   - The live editor flow and `/api/citations/audit` both compute audit results.
   - This creates drift in extraction assumptions, scoring, issue categories, and verification status handling.

2. **In-memory job storage**
   - `pipeline.ts` stores jobs in a local `Map`.
   - Completed jobs are lost on restart, deploy, or horizontal scaling.
   - SSE clients cannot resume progress after a server restart.

3. **No persisted evidence**
   - Verification candidates, provider responses, semantic support, and issue snapshots are not stored.
   - This prevents audit history, replay, manual review, and debugging.

4. **Authentication is inconsistent**
   - `/api/audit/start` relies on `authMiddleware` and passes `req.user.id`.
   - `/api/citations/audit` performs its own Supabase token check.
   - `/api/citations/forensic-audit` uses `authenticate` plus `checkProjectAccess`.
   - A single audit path should centralize auth and authorization checks.

5. **Verification status classification is incomplete**
   - The pipeline treats `VERIFICATION_FAILED` as hallucination and everything else as mismatch.
   - It does not yet distinguish provider outage, rate limits, missing DOI, books, historical sources, or weak metadata.

6. **Scoring is heuristic**
   - The current score is penalty-based and understandable, but not statistically calibrated.
   - Future scoring should be transparent, weighted by evidence confidence, and explainable per issue.

7. **Frontend report expectations are mixed**
   - The sidebar and panels now accept both old and current verification result shapes.
   - `src/pages/dashboard/CitationAuditReportPage.tsx` still appears to expect older report fields such as `violations`.

## Safe migration path

### Phase 1 — Hardening, completed

- Stronger audit types.
- More resilient extraction.
- Partial-failure tolerant pipeline.
- Frontend compatibility with current backend verification results.

### Phase 2 — Make the pipeline authoritative

- Keep `backend/src/audit` as the single implementation for editor audits.
- Redirect `/api/citations/audit` to the pipeline or mark it legacy.
- Preserve the forensic endpoint for pre-built citation pairs only.

### Phase 3 — Persist jobs and reports, started

Added Prisma models and a tracked SQL reference for:

- `AuditJob`
- `AuditReport`
- `VerificationEvidence`
- `IntegrityScoreSnapshot`

Indexes cover `user_id`, `project_id`, `document_id`, `status`, and `created_at`.

The in-memory `Map` remains as a hot cache for the existing SSE flow. `persistence.ts` writes job progress, reports, verification evidence, and score snapshots in the background without blocking the pipeline if persistence is unavailable. Set `AUDIT_PERSISTENCE_ENABLED=false` to disable persistence writes during local development.

### Phase 4 — Add durable progress

Next, SSE should read from the database first and fall back to memory for active jobs. This will allow completed jobs to survive restarts and deployments.

### Phase 5 — Improve verification classification

Classify external verification results as:

- verified
- not found
- insufficient evidence
- provider error
- rate limited
- metadata mismatch
- potential fabrication

This prevents overstating hallucination risk when the evidence is incomplete.

### Phase 6 — Make scoring explainable

Replace arbitrary penalties with a weighted model that reports:

- source existence confidence
- metadata match confidence
- semantic support confidence
- bibliography coverage
- duplicate/format/url penalties

The final score should be traceable to individual evidence items.
