"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PdfConversionService = void 0;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const uuid_1 = require("uuid");
const logger_1 = __importDefault(require("../monitoring/logger"));
class PdfConversionService {
    /**
     * Converts a PDF file to DOCX using LibreOffice
     * @param inputPath Path to the input PDF file or Buffer of the PDF
     * @returns Path to the generated DOCX file
     */
    static async convertPdfToDocx(input) {
        const tempDir = path_1.default.join("/tmp", (0, uuid_1.v4)());
        // Ensure /tmp exists (mostly for local Windows dev where /tmp might not exist, 
        // but code uses absolute /tmp. On Windows this might be C:\tmp. 
        // Better to use os.tmpdir() but User specified /tmp explicitly or implied standard linux paths. 
        // I'll stick to user logic but ensure directory creation works).
        // Actually, fs.ensureDir works.
        // For Windows compatibility, we should probably use strict paths if running locally, 
        // but the target is Render (Linux). I'll keep user's logic but maybe use path.join for safety.
        await fs_extra_1.default.ensureDir(tempDir);
        let inputPdfPath;
        if (Buffer.isBuffer(input)) {
            inputPdfPath = path_1.default.join(tempDir, "input.pdf");
            await fs_extra_1.default.writeFile(inputPdfPath, input);
        }
        else {
            // If it's a file path, we can try to use it directly, 
            // BUT libreoffice might have issues with permissions or weird filenames.
            // Copying to temp dir is safer.
            inputPdfPath = path_1.default.join(tempDir, "input.pdf");
            await fs_extra_1.default.copy(input, inputPdfPath);
        }
        const outputDir = tempDir;
        logger_1.default.info(`[LibreOffice] Starting conversion for ${inputPdfPath}`);
        return new Promise((resolve, reject) => {
            (0, child_process_1.exec)(`libreoffice --headless --convert-to docx "${inputPdfPath}" --outdir "${outputDir}"`, async (err, stdout, stderr) => {
                if (err) {
                    logger_1.default.error("[LibreOffice] Conversion failed", { error: err.message, stderr });
                    return reject(err);
                }
                logger_1.default.info("[LibreOffice] Conversion stdout", { stdout });
                try {
                    const files = await fs_extra_1.default.readdir(outputDir);
                    const docxFile = files.find((f) => f.endsWith(".docx"));
                    if (!docxFile) {
                        reject(new Error("DOCX conversion failed: No output file created"));
                        return;
                    }
                    resolve(path_1.default.join(outputDir, docxFile));
                }
                catch (readErr) {
                    reject(readErr);
                }
            });
        });
    }
}
exports.PdfConversionService = PdfConversionService;
