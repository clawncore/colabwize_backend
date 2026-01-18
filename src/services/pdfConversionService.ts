import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import logger from '../monitoring/logger';

export class PdfConversionService {
    /**
     * Converts a PDF file to DOCX format while preserving formatting, images, and styles
     */
    static async convertPdfToDocx(pdfFilePath: string): Promise<string> {
        const startTime = Date.now();

        try {
            logger.info('[PDF-CONVERSION] Starting PDF to DOCX conversion', {
                pdfFilePath,
                timestamp: startTime
            });

            // Generate output path for the converted file
            const outputDir = path.dirname(pdfFilePath);
            const baseName = path.basename(pdfFilePath, '.pdf');
            const docxFilePath = path.join(outputDir, `${baseName}.docx`);

            // Check if LibreOffice is available
            const libreOfficeAvailable = await this.isLibreOfficeAvailable();
            if (!libreOfficeAvailable) {
                logger.warn('[PDF-CONVERSION] LibreOffice not found, attempting conversion with alternative method');
                throw new Error('LibreOffice is not available on this server. PDF conversion requires LibreOffice or similar office suite.');
            }

            // Use LibreOffice in headless mode to convert PDF to DOCX
            const conversionProcess = spawn('libreoffice', [
                '--headless',
                '--invisible',
                '--convert-to', 'docx',
                '--outdir', outputDir,
                pdfFilePath
            ]);

            // Set up promise to handle the conversion process
            return new Promise<string>((resolve, reject) => {
                let stdout = '';
                let stderr = '';

                conversionProcess.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                conversionProcess.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                conversionProcess.on('close', (code) => {
                    const duration = Date.now() - startTime;
                    logger.info(`[PDF-CONVERSION] Process completed`, {
                        exitCode: code,
                        duration,
                        stdout,
                        stderr: stderr || 'none'
                    });

                    if (code === 0) {
                        // Check if the DOCX file was created
                        fs.access(docxFilePath)
                            .then(() => {
                                logger.info('[PDF-CONVERSION] Conversion successful', {
                                    docxFilePath,
                                    duration
                                });
                                resolve(docxFilePath);
                            })
                            .catch(() => {
                                logger.error('[PDF-CONVERSION] Conversion process succeeded but DOCX file not found', {
                                    expectedPath: docxFilePath
                                });
                                reject(new Error('Conversion process completed successfully but DOCX file was not created'));
                            });
                    } else {
                        logger.error('[PDF-CONVERSION] Conversion failed', {
                            exitCode: code,
                            stderr,
                            duration
                        });
                        reject(new Error(`PDF to DOCX conversion failed with exit code ${code}: ${stderr}`));
                    }
                });

                // Handle spawn errors
                conversionProcess.on('error', (error) => {
                    const duration = Date.now() - startTime;
                    logger.error('[PDF-CONVERSION] Spawn error during conversion', {
                        error: error.message,
                        duration
                    });
                    reject(new Error(`Failed to start PDF conversion: ${error.message}`));
                });
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            logger.error('[PDF-CONVERSION] Unexpected error during PDF to DOCX conversion', {
                error: error.message,
                stack: error.stack,
                pdfFilePath,
                duration
            });
            throw new Error(`PDF to DOCX conversion failed: ${error.message}`);
        }
    }

    /**
     * Checks if LibreOffice is available on the system
     */
    private static async isLibreOfficeAvailable(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const child = spawn('libreoffice', ['--help']);

            child.on('error', () => {
                resolve(false);
            });

            child.on('exit', (code) => {
                resolve(code === 0 || code === 1); // LibreOffice returns 1 for help command
            });
        });
    }

    /**
     * Alternative conversion method using unoconv (Python-based LibreOffice wrapper)
     */
    static async convertPdfToDocxUnoconv(pdfFilePath: string): Promise<string> {
        const startTime = Date.now();

        try {
            logger.info('[PDF-CONVERSION-UNOCONV] Starting PDF to DOCX conversion', {
                pdfFilePath,
                timestamp: startTime
            });

            // Generate output path for the converted file
            const outputDir = path.dirname(pdfFilePath);
            const baseName = path.basename(pdfFilePath, '.pdf');
            const docxFilePath = path.join(outputDir, `${baseName}.docx`);

            // Check if unoconv is available
            const unoconvAvailable = await this.isUnoconvAvailable();
            if (!unoconvAvailable) {
                logger.warn('[PDF-CONVERSION-UNOCONV] Unoconv not found');
                throw new Error('Unoconv is not available on this server. PDF conversion requires unoconv or LibreOffice.');
            }

            const conversionProcess = spawn('unoconv', [
                '-f', 'docx',
                '-o', outputDir,
                pdfFilePath
            ]);

            return new Promise<string>((resolve, reject) => {
                let stderr = '';

                conversionProcess.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                conversionProcess.on('close', (code) => {
                    const duration = Date.now() - startTime;
                    logger.info(`[PDF-CONVERSION-UNOCONV] Process completed`, {
                        exitCode: code,
                        duration,
                        stderr: stderr || 'none'
                    });

                    if (code === 0) {
                        // Check if the DOCX file was created
                        fs.access(docxFilePath)
                            .then(() => {
                                logger.info('[PDF-CONVERSION-UNOCONV] Conversion successful', {
                                    docxFilePath,
                                    duration
                                });
                                resolve(docxFilePath);
                            })
                            .catch(() => {
                                logger.error('[PDF-CONVERSION-UNOCONV] Conversion process succeeded but DOCX file not found', {
                                    expectedPath: docxFilePath
                                });
                                reject(new Error('Conversion process completed successfully but DOCX file was not created'));
                            });
                    } else {
                        logger.error('[PDF-CONVERSION-UNOCONV] Conversion failed', {
                            exitCode: code,
                            stderr,
                            duration
                        });
                        reject(new Error(`PDF to DOCX conversion failed with exit code ${code}: ${stderr}`));
                    }
                });

                conversionProcess.on('error', (error) => {
                    const duration = Date.now() - startTime;
                    logger.error('[PDF-CONVERSION-UNOCONV] Spawn error during conversion', {
                        error: error.message,
                        duration
                    });
                    reject(new Error(`Failed to start PDF conversion: ${error.message}`));
                });
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            logger.error('[PDF-CONVERSION-UNOCONV] Unexpected error during PDF to DOCX conversion', {
                error: error.message,
                stack: error.stack,
                pdfFilePath,
                duration
            });
            throw new Error(`PDF to DOCX conversion failed: ${error.message}`);
        }
    }

    /**
     * Checks if unoconv is available on the system
     */
    private static async isUnoconvAvailable(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const child = spawn('unoconv', ['--help']);

            child.on('error', () => {
                resolve(false);
            });

            child.on('exit', (code) => {
                resolve(code === 0 || code === 1); // unoconv returns 1 for help command
            });
        });
    }

    /**
     * Fallback conversion using Ghostscript + other tools (for complex PDFs)
     * This is a more complex method but can handle difficult PDFs
     */
    static async convertPdfToDocxAdvanced(pdfFilePath: string): Promise<string> {
        // This would implement more advanced conversion techniques
        // For now, we'll throw an error indicating that this requires additional setup
        throw new Error(
            'Advanced PDF conversion requires additional setup including ' +
            'Poppler, Ghostscript, and Pandoc. ' +
            'Please install these tools or use LibreOffice for basic conversion.'
        );
    }
}