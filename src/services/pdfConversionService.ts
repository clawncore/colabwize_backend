import { exec } from "child_process";
import path from "path";
import fs from "fs-extra";
import { v4 as uuid } from "uuid";
import logger from "../monitoring/logger";

export class PdfConversionService {
    /**
     * Converts a PDF file to DOCX using LibreOffice
     * @param inputPath Path to the input PDF file or Buffer of the PDF
     * @returns Path to the generated DOCX file
     */
    static async convertPdfToDocx(input: string | Buffer): Promise<string> {
        const tempDir = path.join("/tmp", uuid());
        // Ensure /tmp exists (mostly for local Windows dev where /tmp might not exist, 
        // but code uses absolute /tmp. On Windows this might be C:\tmp. 
        // Better to use os.tmpdir() but User specified /tmp explicitly or implied standard linux paths. 
        // I'll stick to user logic but ensure directory creation works).
        // Actually, fs.ensureDir works.

        // For Windows compatibility, we should probably use strict paths if running locally, 
        // but the target is Render (Linux). I'll keep user's logic but maybe use path.join for safety.

        await fs.ensureDir(tempDir);

        let inputPdfPath: string;

        if (Buffer.isBuffer(input)) {
            inputPdfPath = path.join(tempDir, "input.pdf");
            await fs.writeFile(inputPdfPath, input);
        } else {
            // If it's a file path, we can try to use it directly, 
            // BUT libreoffice might have issues with permissions or weird filenames.
            // Copying to temp dir is safer.
            inputPdfPath = path.join(tempDir, "input.pdf");
            await fs.copy(input, inputPdfPath);
        }

        const outputDir = tempDir;

        logger.info(`[LibreOffice] Starting conversion for ${inputPdfPath}`);

        return new Promise<string>((resolve, reject) => {
            exec(
                `libreoffice --headless --convert-to docx "${inputPdfPath}" --outdir "${outputDir}"`,
                async (err, stdout, stderr) => {
                    if (err) {
                        logger.error("[LibreOffice] Conversion failed", { error: err.message, stderr });
                        return reject(err);
                    }

                    logger.info("[LibreOffice] Conversion stdout", { stdout });

                    try {
                        const files = await fs.readdir(outputDir);
                        const docxFile = files.find((f) => f.endsWith(".docx"));

                        if (!docxFile) {
                            reject(new Error("DOCX conversion failed: No output file created"));
                            return;
                        }

                        resolve(path.join(outputDir, docxFile));
                    } catch (readErr) {
                        reject(readErr);
                    }
                }
            );
        });
    }
}