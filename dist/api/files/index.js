"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const upload_1 = __importDefault(require("./upload"));
const serve_1 = __importDefault(require("./serve"));
const fileProcessing_1 = __importDefault(require("./fileProcessing"));
const router = (0, express_1.Router)();
// Mount file upload routes
router.use("/", upload_1.default);
// Mount file serving routes
router.use("/", serve_1.default);
// Mount file processing routes
router.use("/process", fileProcessing_1.default);
exports.default = router;
