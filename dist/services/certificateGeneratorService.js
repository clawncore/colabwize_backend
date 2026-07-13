"use strict";
// This file is deprecated in favor of authorshipCertificateGenerator.ts
// which now uses HTML-to-PDF with Puppeteer for better design control
Object.defineProperty(exports, "__esModule", { value: true });
exports.CertificateGeneratorService = void 0;
var authorshipCertificateGenerator_1 = require("./authorshipCertificateGenerator");
Object.defineProperty(exports, "CertificateGeneratorService", { enumerable: true, get: function () { return authorshipCertificateGenerator_1.AuthorshipCertificateGenerator; } });
