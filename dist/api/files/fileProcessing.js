"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const file_processing_1 = __importDefault(require("../../hybrid/serverless/file-processing"));
const router = (0, express_1.Router)();
// Process file (import/export operations)
router.post("/", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        // Create a mock request object that matches the expected interface in file-processing.ts
        const mockRequest = {
            json: async () => ({
                fileData: req.body.fileData,
                fileType: req.body.fileType,
                userId: req.user.id,
            }),
        };
        // Call the serverless function
        const response = await (0, file_processing_1.default)(mockRequest);
        // Handle different response types based on headers
        const contentType = response.headers.get("Content-Type") || "";
        if (contentType.includes("application/json")) {
            const responseData = await response.json();
            res.status(response.status).json(responseData);
        }
        else {
            // Pass headers forward (like Content-Disposition for attachments)
            response.headers.forEach((value, key) => {
                res.setHeader(key, value);
            });
            // Send binary buffer directly
            const arrayBuffer = await response.arrayBuffer();
            res.status(response.status).end(Buffer.from(arrayBuffer));
        }
    }
    catch (error) {
        logger_1.default.error("File processing API error", {
            error: error.message,
            stack: error.stack,
        });
        res.status(500).json({
            success: false,
            error: error.message || "Internal server error",
        });
    }
});
exports.default = router;
