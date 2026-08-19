import type { OutputFormat, CanonicalDocument, CslStyle } from "../cdm";
import type { PpeSettings } from "../ppe/types";

/**
 * Phase 3 — Export Job System domain types.
 *
 * The job system decouples the HTTP request (which only *enqueues*) from the
 * (possibly heavy, async) generation work performed by a worker. Jobs are
 * DB-backed and survive process restarts; workers are stateless and poll.
 */

export type ExportJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "RETRYING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

/** Per-job rendering options, persisted as JSON on the record. */
export interface ExportJobSettings {
  cslStyle?: CslStyle;
  templateId?: string;
  enableCiteproc?: boolean;
  title?: string;
  /** Phase 5: deliver the finished artifact to this destination (see destinations). */
  destination?: string;
  /** Publication Export Engine settings (submission packages). */
  ppe?: PpeSettings;
}

/** A persisted export job (the normalized row shape, post-parse). */
export interface ExportJobRecord {
  id: string;
  userId: string;
  projectId: string | null;
  docVersionId: string | null;
  format: OutputFormat;
  status: ExportJobStatus;
  attempts: number;
  maxAttempts: number;
  progress: number;
  statusMessage: string | null;
  settings: ExportJobSettings;
  artifactPath: string | null;
  artifactUrl: string | null;
  artifactMimeType: string | null;
  artifactSize: number | null;
  artifactChecksum: string | null;
  billingEventId: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** Everything a client needs to download the finished artifact. */
export interface ArtifactDescriptor {
  path: string;
  url: string;
  mimeType: string;
  size: number;
  checksum: string;
}

/** Input to the service when creating a job. */
export interface CreateExportJobInput {
  userId: string;
  projectId?: string;
  docVersionId?: string;
  format: OutputFormat;
  settings?: ExportJobSettings;
  /** Optional pre-resolved CDM; if omitted the resolver fetches it. */
  cdm?: CanonicalDocument;
}

/** Request-level result returned to the caller. */
export interface ExportJobEnqueued {
  jobId: string;
  /** True when the work completed synchronously (fast path). */
  completed: boolean;
  status: ExportJobStatus;
  artifact: ArtifactDescriptor | null;
}

/** Lightweight progress event emitted over SSE / stored on the record. */
export interface ExportJobProgressEvent {
  jobId: string;
  status: ExportJobStatus;
  progress: number;
  message: string | null;
  at: string; // ISO timestamp
}

export const TERMINAL_STATUSES: readonly ExportJobStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

export function isTerminal(status: ExportJobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Map an engine-level OutputFormat to the matching Prisma OutputFormat value. */
export function normalizeFormat(format: string): OutputFormat {
  const allowed: OutputFormat[] = [
    "pdf",
    "docx",
    "latex",
    "html",
    "rtf",
    "md",
    "epub",
    "txt",
    "submission",
  ];
  const f = format.toLowerCase();
  if (allowed.includes(f as OutputFormat)) return f as OutputFormat;
  throw new Error(`Unsupported export format: ${format}`);
}

export type { CanonicalDocument };
