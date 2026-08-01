"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const certificates_1 = require("./certificates");
const certificates_2 = require("./certificates");
const activity_1 = __importDefault(require("./activity"));
const generate_1 = require("./generate");
const verify_1 = __importDefault(require("../certificates/verify"));
const v2_1 = __importDefault(require("./v2"));
const router = express_1.default.Router();
// Public verification route
router.use("/", verify_1.default);
// Activity Tracking Routes (MVP Core)
router.use("/", activity_1.default);
// V2 Authorship Evidence Routes
router.use("/", v2_1.default);
// GET /api/authorship/certificates - Get all certificates for the authenticated user
router.get("/certificates", certificates_1.getCertificates);
// GET /api/authorship/certificates/:id/download - Download a certificate
router.get("/certificates/:id/download", certificates_1.downloadCertificate);
// GET /api/authorship/certificates/:id - Get a specific certificate by ID
router.get("/certificates/:id", certificates_1.getCertificateById);
// POST /api/authorship/certificates - Create a new certificate (Manual Entry)
router.post("/certificates", certificates_1.createCertificate);
// POST /api/authorship/generate-certificate - Generate and Create a new certificate
router.post("/generate", generate_1.generateCertificate);
// PUT /api/authorship/certificates/:id - Update a certificate
router.put("/certificates/:id", certificates_1.updateCertificate);
// DELETE /api/authorship/certificates/:id - Delete a certificate
router.delete("/certificates/:id", certificates_1.deleteCertificate);
// GET /api/authorship/certificates/:id/download - Download a certificate
router.get("/certificates/:id/download", certificates_1.downloadCertificate);
// GET /api/authorship/verification-time - Get time to verification statistics
router.get("/verification-time", certificates_2.getTimeToVerification);
exports.default = router;
