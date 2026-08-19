/**
 * SubmissionPackageAdapter — the OutputAdapter that turns a CDM into a
 * publisher-compliant `Submission.zip` via the Publication Export Engine.
 *
 * It delegates sub-document rendering (Manuscript/Figures/Tables/CoverLetter in
 * DOCX/LaTeX/PDF) to the shared PublishingEngine, then zips every produced file
 * with adm-zip. Registered in `PublishingEngine.defaultAdapters()` so a job with
 * `format: "submission"` flows through the normal export pipeline unchanged.
 */
import AdmZip from "adm-zip";
import { createHash } from "crypto";
import type { CanonicalDocument, OutputFormat } from "../cdm";
import type {
  AdapterComplexity,
  GenCtx,
  GenResult,
  OutputAdapter,
} from "../types";
import { publishingEngine } from "../engine";
import { buildSubmissionPackage, type PackageBuildDeps } from "./package";
import type { PpeSettings } from "./types";

const SUBMISSION_MIME = "application/zip";

export class SubmissionPackageAdapter implements OutputAdapter {
  format: OutputFormat = "submission";
  supportedFormats: OutputFormat[] = ["submission"];
  private readonly engine: PackageBuildDeps["engine"];

  constructor(engine?: PackageBuildDeps["engine"]) {
    this.engine = engine ?? publishingEngine;
  }

  estimateComplexity(): AdapterComplexity {
    // Packages always run through the async worker (slow path).
    return "slow";
  }

  async generate(doc: CanonicalDocument, ctx: GenCtx): Promise<GenResult> {
    // Resolve the engine lazily: at construction time (during the shared
    // `publishingEngine` init) the binding may not be assigned yet.
    const engine = this.engine ?? publishingEngine;
    const settings: PpeSettings = ctx.ppe ?? { mode: "publication" };
    const built = await buildSubmissionPackage(
      doc,
      settings.profileId ?? "generic",
      settings,
      { engine },
    );

    const zip = new AdmZip();
    for (const file of built.files) {
      zip.addFile(file.path, file.bytes);
    }
    const buffer = zip.toBuffer();
    const checksum = createHash("sha256").update(buffer).digest("hex");

    return {
      format: "submission",
      buffer,
      mimeType: SUBMISSION_MIME,
      sizeBytes: buffer.length,
      checksum,
    };
  }
}
