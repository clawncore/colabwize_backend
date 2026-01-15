import express from "express";
import {
  getCertificates,
  getCertificateById,
  createCertificate,
  deleteCertificate,
  updateCertificate,
  downloadCertificate,
} from "./certificates";
import { getTimeToVerification } from "./certificates";
import activityRouter from "./activity";
import { generateCertificate } from "./generate";
import verifyRouter from "../certificates/verify";

const router = express.Router();

// Public verification route
router.use("/", verifyRouter);

// Activity Tracking Routes (MVP Core)
router.use("/", activityRouter);

// GET /api/authorship/certificates - Get all certificates for the authenticated user
router.get("/certificates", getCertificates);

// GET /api/authorship/certificates/:id/download - Download a certificate
router.get("/certificates/:id/download", downloadCertificate);

// GET /api/authorship/certificates/:id - Get a specific certificate by ID
router.get("/certificates/:id", getCertificateById);

// POST /api/authorship/certificates - Create a new certificate (Manual Entry)
router.post("/certificates", createCertificate);

// POST /api/authorship/generate-certificate - Generate and Create a new certificate
router.post("/generate", generateCertificate);

// PUT /api/authorship/certificates/:id - Update a certificate
router.put("/certificates/:id", updateCertificate);

// DELETE /api/authorship/certificates/:id - Delete a certificate
router.delete("/certificates/:id", deleteCertificate);

// GET /api/authorship/certificates/:id/download - Download a certificate
router.get("/certificates/:id/download", downloadCertificate);

// GET /api/authorship/verification-time - Get time to verification statistics
router.get("/verification-time", getTimeToVerification);

export default router;
