"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const route_1 = require("./route");
const multer_1 = __importDefault(require("multer"));
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)(); // Memory storage by default
// Apply auth middleware to all routes or specific ones?
// UPLOAD_PDF handles its own fallback, but ideally we want auth.
// Let's apply it to GET routes for sure.
// GET /api/pdf - List PDFs
router.get("/", auth_1.authenticateExpressRequest, route_1.GET_PDFS);
// GET /api/pdf/:id - Get single PDF
router.get("/:id", auth_1.authenticateExpressRequest, route_1.GET_PDF);
// POST /api/pdf/upload
// Note: We might want to add authMiddleware here too if we remove the fallback logic later.
// For now, allow fallback logic inside UPLOAD_PDF to run if middleware is skipped?
// But authenticateExpressRequest blocks if no token.
// If valid dev env, we might want to skip it?
// Let's try adding it. It safer.
router.post("/upload", auth_1.authenticateExpressRequest, upload.single("file"), route_1.UPLOAD_PDF);
// POST /api/pdf/chat
router.post("/chat", auth_1.authenticateExpressRequest, route_1.CHAT_PDF);
// GET /api/pdf/:id/download
router.get("/:id/download", auth_1.authenticateExpressRequest, route_1.GET_PDF_DOWNLOAD);
// GET /api/pdf/:id/related
// @ts-ignore
router.get("/:id/related", auth_1.authenticateExpressRequest, route_1.GET_PDF_RELATED);
exports.default = router;
