"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TERMINAL_STATUSES = void 0;
exports.isTerminal = isTerminal;
exports.normalizeFormat = normalizeFormat;
exports.TERMINAL_STATUSES = [
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
];
function isTerminal(status) {
    return exports.TERMINAL_STATUSES.includes(status);
}
/** Map an engine-level OutputFormat to the matching Prisma OutputFormat value. */
function normalizeFormat(format) {
    const allowed = [
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
    if (allowed.includes(f))
        return f;
    throw new Error(`Unsupported export format: ${format}`);
}
