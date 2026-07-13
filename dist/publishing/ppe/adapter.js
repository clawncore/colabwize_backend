"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubmissionPackageAdapter = void 0;
/**
 * SubmissionPackageAdapter — the OutputAdapter that turns a CDM into a
 * publisher-compliant `Submission.zip` via the Publication Export Engine.
 *
 * It delegates sub-document rendering (Manuscript/Figures/Tables/CoverLetter in
 * DOCX/LaTeX/PDF) to the shared PublishingEngine, then zips every produced file
 * with adm-zip. Registered in `PublishingEngine.defaultAdapters()` so a job with
 * `format: "submission"` flows through the normal export pipeline unchanged.
 */
const adm_zip_1 = __importDefault(require("adm-zip"));
const crypto_1 = require("crypto");
const engine_1 = require("../engine");
const package_1 = require("./package");
const SUBMISSION_MIME = "application/zip";
class SubmissionPackageAdapter {
    format = "submission";
    supportedFormats = ["submission"];
    engine;
    constructor(engine) {
        this.engine = engine ?? engine_1.publishingEngine;
    }
    estimateComplexity() {
        // Packages always run through the async worker (slow path).
        return "slow";
    }
    async generate(doc, ctx) {
        // Resolve the engine lazily: at construction time (during the shared
        // `publishingEngine` init) the binding may not be assigned yet.
        const engine = this.engine ?? engine_1.publishingEngine;
        const settings = ctx.ppe ?? { mode: "publication" };
        const built = await (0, package_1.buildSubmissionPackage)(doc, settings.profileId ?? "generic", settings, { engine });
        const zip = new adm_zip_1.default();
        for (const file of built.files) {
            zip.addFile(file.path, file.bytes);
        }
        const buffer = zip.toBuffer();
        const checksum = (0, crypto_1.createHash)("sha256").update(buffer).digest("hex");
        return {
            format: "submission",
            buffer,
            mimeType: SUBMISSION_MIME,
            sizeBytes: buffer.length,
            checksum,
        };
    }
}
exports.SubmissionPackageAdapter = SubmissionPackageAdapter;
