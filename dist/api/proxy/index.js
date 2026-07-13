"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../../monitoring/logger"));
const router = express_1.default.Router();
/**
 * @route GET /api/proxy/pdf
 * @desc Proxy a PDF file from an external URL to bypass CORS
 * @access Private
 */
router.get("/pdf", async (req, res) => {
    try {
        const { url } = req.query;
        if (!url || typeof url !== "string") {
            return res.status(400).json({ success: false, message: "URL is required" });
        }
        logger_1.default.info(`Proxying PDF request`, { url });
        const response = await (0, axios_1.default)({
            method: "GET",
            url: url,
            responseType: "stream",
            headers: {
                // Mimic a browser to avoid some basic blocking
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            }
        });
        const contentType = response.headers["content-type"];
        logger_1.default.info(`Proxying PDF response headers`, { contentType, contentLength: response.headers["content-length"] });
        // Security: Block HTML responses which are potential protection challenges or error pages
        if (contentType && contentType.includes("text/html")) {
            logger_1.default.warn("Blocked proxy request returning HTML", { url });
            return res.status(400).json({
                success: false,
                message: "The remote source returned a webpage instead of a PDF. This might be due to a login requirement or bot protection."
            });
        }
        // Forward content type
        if (contentType) {
            res.setHeader("Content-Type", contentType);
        }
        else {
            res.setHeader("Content-Type", "application/pdf");
        }
        // Forward content length if available
        if (response.headers["content-length"]) {
            res.setHeader("Content-Length", response.headers["content-length"]);
        }
        // Pipe the stream
        response.data.pipe(res);
    }
    catch (error) {
        logger_1.default.error("PDF Proxy Error", { error: error.message, url: req.query.url });
        if (error.response) {
            res.status(error.response.status).json({ success: false, message: "Failed to fetch remote PDF" });
        }
        else {
            res.status(500).json({ success: false, message: "Internal server error during proxy" });
        }
    }
});
exports.default = router;
