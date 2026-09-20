import express from "express";
import axios from "axios";
import logger from "../../monitoring/logger";

const router = express.Router();

// Security configuration for PDF proxy
const ALLOWED_PDF_HOSTS = [
  "arxiv.org",
  "arxiv.org/pdf",
  "pubmed.ncbi.nlm.nih.gov",
  "www.ncbi.nlm.nih.gov",
  "academic.oup.com",
  "ieeexplore.ieee.org",
  "link.springer.com",
  "journals.plos.org",
  "www.sciencedirect.com",
  "dl.acm.org",
  "jamanetwork.com",
  "nejm.org",
  "thelancet.com",
  "bmj.com",
  "annals.org",
  "jama.network.com",
  "Nature.com",
  "www.nature.com"
];

const BLOCKED_IP_RANGES = [
  // Private IP ranges (RFC 1918)
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  // Loopback
  /^127\./,
  /^::1$/,
  /^fe80:/,
  // Link-local
  /^169\.254\./,
  // Reserved
  /^0\./,
  /^192\.0\.0\./,
  /^192\.0\.2\./,
  /^192\.88\.99\./,
  /^198\.18\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^198\.51\.100\./,
  /^203\.0\.113\./,
  /^224\./,
  /^240\./
];

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

        // Parse URL for validation
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch (err) {
            return res.status(400).json({
                success: false,
                message: "Invalid URL format"
            });
        }

        // Enforce HTTPS only
        if (parsedUrl.protocol !== "https:") {
            return res.status(400).json({
                success: false,
                message: "Only HTTPS URLs are allowed"
            });
        }

        // Check against blocked IP ranges
        const host = parsedUrl.hostname;
        for (const pattern of BLOCKED_IP_RANGES) {
            if (pattern.test(host)) {
                logger.warn(`Blocked proxy request to restricted IP: ${host}`, { url });
                return res.status(403).json({
                    success: false,
                    message: "Access to restricted IP addresses is not allowed"
                });
            }
        }

        // Check against allowed hosts (if list is not empty)
        if (ALLOWED_PDF_HOSTS.length > 0) {
            const isAllowed = ALLOWED_PDF_HOSTS.some(allowedHost =>
                host === allowedHost || host.endsWith(`.${allowedHost}`)
            );

            if (!isAllowed) {
                logger.warn(`Blocked proxy request to non-whitelisted host: ${host}`, { url });
                return res.status(403).json({
                    success: false,
                    message: "Host is not allowed for PDF proxy"
                });
            }
        }

        logger.info(`Proxying PDF request`, { url });

        const response = await axios({
            method: "GET",
            url: url,
            responseType: "stream",
            timeout: 15000, // 15 seconds timeout
            maxContentLength: 25 * 1024 * 1024, // 25MB max content length
            maxBodyLength: 25 * 1024 * 1024, // 25MB max body length
            headers: {
                // Mimic a browser to avoid some basic blocking
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            }
        });

        const contentType = response.headers["content-type"];
        const contentLength = response.headers["content-length"];
        logger.info(`Proxying PDF response headers`, { contentType, contentLength });

        // Security: Block HTML responses which are potential protection challenges or error pages
        const ctStr = Array.isArray(contentType) ? contentType[0] : contentType;
        if (ctStr && typeof ctStr === "string" && ctStr.includes("text/html")) {
            logger.warn("Blocked proxy request returning HTML", { url });
            return res.status(400).json({
                success: false,
                message: "The remote source returned a webpage instead of a PDF. This might be due to a login requirement or bot protection."
            });
        }

        // Additional content-type validation for PDFs
        if (ctStr && typeof ctStr === "string" && !ctStr.includes("application/pdf")) {
            logger.warn(`Blocked proxy request with unexpected content type: ${contentType}`, { url });
            return res.status(400).json({
                success: false,
                message: "The remote source did not return a PDF file"
            });
        }

        // Forward content type
        if (ctStr && typeof ctStr === "string") {
            res.setHeader("Content-Type", ctStr);
        } else {
            res.setHeader("Content-Type", "application/pdf");
        }

        // Forward content length if available
        if (typeof contentLength === "string") {
            res.setHeader("Content-Length", contentLength);
        } else if (Array.isArray(contentLength)) {
            res.setHeader("Content-Length", String(contentLength[0]));
        }

        // Pipe the stream
        response.data.pipe(res);

    } catch (error: any) {
        logger.error("PDF Proxy Error", { error: error.message, url: req.query.url });

        if (error.code === "ECONNABORTED") {
            res.status(408).json({ success: false, message: "Request timeout" });
        } else if (error.code === "ERR_STREAM_PREMATURE_CLOSE") {
            res.status(400).json({ success: false, message: "Connection closed unexpectedly" });
        } else if (error.response) {
            res.status(error.response.status).json({ success: false, message: "Failed to fetch remote PDF" });
        } else {
            res.status(500).json({ success: false, message: "Internal server error during proxy" });
        }
    }
});

export default router;
