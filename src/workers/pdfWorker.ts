import { parentPort } from 'worker_threads';
import fs from 'fs/promises';
import pdfParse from 'pdf-parse';

if (!parentPort) {
    throw new Error('This module must be run as a worker thread');
}

parentPort.on('message', async (message: { filePath: string }) => {
    try {
        if (!message.filePath) {
            throw new Error('No file path provided');
        }

        const buffer = await fs.readFile(message.filePath);
        const data = await pdfParse(buffer);

        parentPort?.postMessage({
            success: true,
            text: data.text
        });
    } catch (error: any) {
        parentPort?.postMessage({
            success: false,
            error: error.message || 'PDF parsing failed'
        });
    }
});
