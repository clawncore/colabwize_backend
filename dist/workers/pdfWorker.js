"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const promises_1 = __importDefault(require("fs/promises"));
const pdf_parse_1 = __importDefault(require("pdf-parse"));
if (!worker_threads_1.parentPort) {
    throw new Error('This module must be run as a worker thread');
}
worker_threads_1.parentPort.on('message', async (message) => {
    try {
        if (!message.filePath) {
            throw new Error('No file path provided');
        }
        const buffer = await promises_1.default.readFile(message.filePath);
        const data = await (0, pdf_parse_1.default)(buffer);
        worker_threads_1.parentPort?.postMessage({
            success: true,
            text: data.text
        });
    }
    catch (error) {
        worker_threads_1.parentPort?.postMessage({
            success: false,
            error: error.message || 'PDF parsing failed'
        });
    }
});
