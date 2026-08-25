import logger from "../monitoring/logger";
import { AuthorshipReportService } from "./authorshipReportService";
import { AuthorshipConfidenceReportPayload } from "../types/authorshipEvidence";
import QRCode from "qrcode";
import { config } from "../config/env";
import fs from "node:fs";
import path from "node:path";

export interface CertificateOptions {
  projectId: string;
  userId: string;
  userName: string;
  projectTitle: string;
  certificateType?: "authorship" | "originality" | "completion";
  includeQRCode?: boolean;
  verificationUrl?: string;
  description?: string;
  watermark?: boolean; // New option for watermark
  confidenceReport?: AuthorshipConfidenceReportPayload;
}

export class AuthorshipCertificateGenerator {
  /**
   * Generate authorship certificate PDF with elegant landscape design
   */
  static async generateCertificate(
    options: CertificateOptions
  ): Promise<Buffer> {
    try {
      logger.info("Generating elegant authorship certificate", {
        projectId: options.projectId,
        userId: options.userId,
        type: options.certificateType || "authorship",
      });

      // Get authorship statistics
      const stats = await AuthorshipReportService.generateAuthorshipReport(
        options.projectId,
        options.userId
      );

      // Generate QR code for bottom-right corner
      const qrCodeDataUrl =
        options.includeQRCode && options.verificationUrl
          ? await this.generateQRCodeDataURL(options.verificationUrl)
          : null;

      // Generate certificate HTML
      const html = await this.generateCertificateHTML(
        options,
        stats,
        qrCodeDataUrl
      );

      // Convert HTML to PDF using Puppeteer (landscape)
      const pdfBuffer = await this.convertHTMLToPDF(html);

      logger.info("Certificate generated successfully", {
        projectId: options.projectId,
        bufferSize: pdfBuffer.length,
      });

      return pdfBuffer;
    } catch (error: any) {
      logger.error("Error generating certificate", {
        error: error.message,
        stack: error.stack,
        projectId: options.projectId,
      });
      throw new Error(`Failed to generate certificate: ${error.message}`);
    }
  }

  /**
   * Generate elegant certificate HTML with landscape design
   */
  static async generateCertificateHTML(
    options: CertificateOptions,
    stats: any,
    qrCodeDataUrl: string | null
  ): Promise<string> {
    const certificateId = `COLABWIZE-${options.projectId.substring(0, 8).toUpperCase()}`;
    const issueDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const certificateTitle = "Certificate of Authorship and Academic Integrity";
    const confidenceReport = options.confidenceReport;
    const reliabilityLabel = confidenceReport?.overallReliability.label || "Insufficient";
    const reliabilityScore = confidenceReport?.overallReliability.score ?? 0;
    const evidenceSummary = confidenceReport?.evidenceSummary;
    const limitations = confidenceReport?.limitations ?? [];

    // Format hours for description
    const hours = Math.floor(stats.totalTimeInvestedMinutes / 60);

    // Logic for automated content text
    const automatedContentText =
      stats.aiAssistedPercentage === 0
        ? "no automated content detected by the ColabWize platform"
        : `${stats.aiAssistedPercentage}% detected automated content`;

    const certificateDescription =
      options.description ||
      `<em>This evidence-backed certificate summarizes</em> the above-named account's documented contribution to
       '<strong>${options.projectTitle || "Untitled Project"}</strong>' through <strong>${hours} hours</strong> of tracked activity,
       <strong>${stats.manualEditsCount.toLocaleString()} tracked revisions</strong>, and <strong>${stats.automatedContentDetectText || automatedContentText}</strong>.
       The report expresses confidence in platform-observed evidence and does not claim proof of human authorship.`;

    // Academic Palette
    const colors = {
      bg: "#FFFCF5", // Cream/Off-white
      border: "#1A2E44", // Navy Blue
      accent: "#D4AF37", // Muted Gold (Metallic)
      text: "#1A2E44", // Navy Blue Text
      secondaryText: "#333333", // Dark Gray
    };

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap');

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    @page {
      size: 11in 8.5in landscape;
      margin: 0;
    }

    body {
      font-family: 'Cormorant Garamond', 'Times New Roman', serif;
      width: 11in;
      height: 8.5in;
      background-color: ${colors.bg};
      padding: 0.35in;
      color: ${colors.text};
      -webkit-font-smoothing: antialiased;
      overflow: hidden;
    }

    /* Main Double Border Container */
    .certificate-container {
      width: 100%;
      height: 100%;
      border: 5px solid ${colors.border};
      padding: 5px;
      position: relative;
      background-image: repeating-linear-gradient(45deg, rgba(212, 175, 55, 0.03) 0px, rgba(212, 175, 55, 0.03) 1px, transparent 1px, transparent 10px);
    }

    .inner-border {
      width: 100%;
      height: 100%;
      border: 2px solid ${colors.accent};
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      padding: 0.3in;
    }
    
    /* Subtle Watermark */
    /* Subtle Watermark */
    .watermark {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-30deg);
      font-size: 80pt;
      font-weight: 700;
      color: rgba(26, 46, 68, 0.03); /* Extremely subtle */
      white-space: nowrap;
      pointer-events: none;
      z-index: 0;
      text-transform: uppercase;
    }

    /* Ornamental Corners */
    .corner {
      position: absolute;
      width: 60px;
      height: 60px;
      border-color: ${colors.border};
      border-style: solid;
      border-width: 0;
    }
    .tl { top: 6px; left: 6px; border-top-width: 6px; border-left-width: 6px; }
    .tr { top: 6px; right: 6px; border-top-width: 6px; border-right-width: 6px; }
    .bl { bottom: 6px; left: 6px; border-bottom-width: 6px; border-left-width: 6px; }
    .br { bottom: 6px; right: 6px; border-bottom-width: 6px; border-right-width: 6px; }

    /* Header */
    .header {
      width: 100%;
      text-align: center;
      margin-top: 0px;
      position: relative;
      z-index: 1;
    }
    
    .logo-section {
      margin-bottom: 10px;
    }

    .header-text {
      font-family: 'Cormorant Garamond', serif;
      font-size: 28pt;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: ${colors.border};
      margin-bottom: 0px;
      line-height: 1.1;
    }

    /* Content */
    .content {
      width: 100%;
      text-align: center;
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      margin-bottom: 10px;
      position: relative;
      z-index: 1;
    }

    .recipient-name {
      font-family: 'Cormorant Garamond', serif;
      font-size: 34pt;
      font-weight: 700;
      color: ${colors.border};
      margin: 5px auto 10px auto;
      text-transform: none;
      word-break: break-word;
      overflow-wrap: break-word;
      line-height: 1.1;
      max-width: 95%;
    }

    .description {
      font-family: 'Cormorant Garamond', serif;
      font-size: 13pt;
      line-height: 1.4;
      color: ${colors.secondaryText};
      max-width: 90%;
      margin: 0 auto 10px auto;
    }

    // Stats
    .stats-row {
      display: flex;
      justify-content: center;
      gap: 30px;
      margin-top: 5px;
      border-top: 1px solid #CCC;
      border-bottom: 1px solid #CCC;
      padding: 5px 0;
      width: 85%;
      margin-left: auto;
      margin-right: auto;
    }

    .stat-item {
      text-align: center;
      padding: 0 10px;
    }

    .stat-value {
      font-family: 'Cormorant Garamond', serif;
      font-size: 14pt;
      font-weight: 700;
      color: ${colors.border};
    }

    .stat-label {
      font-family: 'Cormorant Garamond', serif;
      font-size: 9pt;
      color: ${colors.secondaryText};
      margin-top: 2px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Footer */
    .footer {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      padding-top: 0px;
      position: relative;
      z-index: 1;
    }

    .signature-block {
      text-align: center;
      width: 250px;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      align-items: center;
    }

    .signature-line {
      border-bottom: 1px solid ${colors.border};
      margin-bottom: 4px;
      width: 100%;
    }

    .signature-text {
      font-family: 'Cormorant Garamond', serif;
      font-size: 9pt;
      font-weight: 600;
      color: ${colors.secondaryText};
    }
    
    .signature-img {
       font-family: 'Brush Script MT', cursive;
       font-size: 16pt;
       margin-bottom: 2px;
       color: ${colors.border};
    }

    /* ROSETTE SEAL STYLES */
    .seal-container {
      position: absolute;
      bottom: -10px;
      left: 50%;
      transform: translateX(-50%);
      text-align: center;
      z-index: 10;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    
    .seal {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: radial-gradient(ellipse at center, #FFD700 0%, #B8860B 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      z-index: 2;
      border: 5px dotted #DAA520; 
      box-shadow: 0 4px 8px rgba(0,0,0,0.4);
    }
    
    .ribbon {
      position: absolute;
      top: 45px;
      width: 20px;
      height: 50px;
      background: linear-gradient(to bottom, #B8860B, #FFD700);
      z-index: 1;
      border: 1px solid #996515;
    }
    
    .ribbon-left {
      left: 50%;
      transform: translateX(-150%) rotate(25deg);
      clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%);
    }
    
    .ribbon-right {
      left: 50%;
      transform: translateX(50%) rotate(-25deg);
      clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%);
    }
    
    .seal-inner {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      border: 2px solid rgba(26, 46, 68, 0.2);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle, rgba(255,255,255,0.1), transparent);
    }

    .seal-text {
      color: ${colors.border};
      font-family: 'Cormorant Garamond', serif;
      font-size: 6pt;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      text-align: center;
      line-height: 1.1;
      text-shadow: 0px 1px 0px rgba(255,255,255,0.4);
    }
    
    .seal-icon {
       font-size: 14px;
       margin: 1px 0;
       color: ${colors.border};
       text-shadow: 0px 1px 0px rgba(255,255,255,0.4);
    }

    /* QR Code */
    .qr-container {
      width: 250px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
    }

    .qr-box {
      border: 1px solid ${colors.accent};
      padding: 4px;
      background: white;
      display: inline-block;
      margin-bottom: 4px;
    }
    
    .qr-box img {
        display: block;
        width: 60px;
        height: 60px;
    }

    .qr-caption {
      font-family: 'Cormorant Garamond', serif;
      font-size: 8pt;
      color: ${colors.border};
      font-weight: 600;
    }

    /* Legal Footer */
    .confidence-grid {
      width: 95%;
      margin: 0 auto 5px auto;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 5px;
    }

    .confidence-card {
      border: none;
      padding: 2px;
      background: transparent;
      text-align: center;
    }

    .confidence-label {
      font-size: 7pt;
      color: ${colors.secondaryText};
      text-transform: uppercase;
      letter-spacing: 0.4px;
      font-weight: 700;
    }

    .confidence-value {
      font-size: 12pt;
      color: ${colors.border};
      font-weight: 800;
      margin-top: 1px;
    }

    .confidence-note {
      font-size: 7pt;
      color: ${colors.secondaryText};
      line-height: 1.2;
      margin-top: 1px;
    }

    .report-section {
      width: 95%;
      margin: 0 auto 0 auto;
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 5px;
      font-family: 'Cormorant Garamond', serif;
    }

    .report-column {
      border: none;
      padding: 4px;
      background: transparent;
      text-align: center;
    }

    .report-column-title {
      font-size: 8.5pt;
      font-weight: 800;
      color: ${colors.border};
      text-transform: uppercase;
      letter-spacing: 0.3px;
      margin-bottom: 2px;
    }

    .report-line {
      font-size: 8pt;
      line-height: 1.2;
      color: ${colors.secondaryText};
      margin: 1px 0;
    }

    .legal-footer {
      position: absolute;
      bottom: 2px;
      left: 0;
      width: 100%;
      text-align: center;
      font-family: 'Cormorant Garamond', serif;
      font-size: 8pt;
      color: ${colors.secondaryText};
      font-weight: 700;
      opacity: 0.8;
    }

  </style>
</head>
<body>
  <div class="certificate-container">
     <div class="watermark">ColabWize Verified</div>

    <div class="corner tl"></div>
    <div class="corner tr"></div>
    <div class="corner bl"></div>
    <div class="corner br"></div>

    <div class="inner-border">
      
      <!-- Header -->
      <div class="header">
        <div class="logo-section" style="display: flex; flex-direction: column; align-items: center; justify-content: center; margin-bottom: 0px;">
          <!-- Inline SVG Logo -->
          <svg version="1.0" xmlns="http://www.w3.org/2000/svg" width="45" height="45" viewBox="0 0 555 555" preserveAspectRatio="xMidYMid meet" style="margin-bottom: 5px;">
            <g transform="translate(0.000000,555.000000) scale(0.100000,-0.100000)" fill="${colors.border}" stroke="none">
              <path d="M2735 5176 c-60 -34 -159 -89 -220 -123 -285 -156 -958 -528 -1255 -694 -47 -26 -236 -130 -420 -232 l-335 -186 -3 -1203 c-2 -1138 -1 -1204 15 -1214 33 -21 229 -122 898 -467 369 -190 801 -413 960 -496 160 -84 341 -178 402 -209 l113 -57 77 41 c256 136 617 327 953 504 212 112 498 262 635 335 138 73 306 162 375 198 69 36 163 86 210 111 l85 45 3 1208 2 1209 -162 89 c-90 48 -253 139 -363 200 -110 61 -252 140 -315 175 -63 35 -196 109 -295 165 -99 56 -250 139 -335 185 -85 46 -317 173 -515 282 -198 109 -369 198 -380 197 -11 0 -69 -28 -130 -63z m151 -115 c8 -9 245 -140 634 -353 202 -111 984 -541 1205 -663 83 -45 170 -93 194 -105 l44 -22 -109 -58 c-60 -31 -354 -188 -654 -347 -300 -160 -717 -381 -926 -491 l-381 -201 -159 83 c-242 126 -660 344 -949 493 -143 74 -296 154 -340 178 -44 23 -207 108 -363 189 -155 82 -280 151 -277 156 6 9 81 52 585 330 874 482 1173 648 1320 731 85 48 157 88 161 88 3 1 9 -3 15 -8z m-1927 -1407 c157 -80 290 -149 295 -155 6 -5 -63 -9 -187 -9 l-197 0 2 -856 3 -855 330 -173 c182 -94 402 -209 490 -255 88 -46 273 -143 410 -216 138 -72 312 -164 388 -203 l137 -72 0 965 c0 766 3 965 13 965 6 -1 62 -26 122 -58 l110 -57 3 -1087 c2 -867 0 -1088 -10 -1088 -11 0 -1035 525 -1930 990 l-278 144 0 1083 c0 596 3 1083 6 1083 4 0 136 -65 293 -146z m4119 -945 l-3 -1071 -125 -67 c-120 -65 -914 -485 -1478 -782 -147 -78 -309 -163 -359 -191 l-93 -49 0 125 0 125 158 84 c370 199 1177 627 1422 754 l265 138 3 950 2 950 93 51 c50 29 98 52 105 53 10 1 12 -216 10 -1070z m-465 44 l-2 -698 -133 -73 c-73 -40 -165 -90 -205 -112 l-72 -38 -63 111 c-35 62 -81 147 -103 189 -22 43 -43 78 -46 78 -3 0 -49 -132 -104 -292 -54 -161 -102 -300 -106 -309 -5 -10 -57 -44 -116 -77 -155 -87 -385 -212 -389 -212 -2 0 -4 327 -4 728 l0 727 143 75 c78 41 147 76 152 78 7 2 9 -180 7 -535 -1 -295 -1 -535 2 -532 2 2 42 114 89 249 47 135 105 300 129 368 l43 124 113 58 113 58 23 -36 c167 -261 236 -373 236 -382 0 -5 5 -10 10 -10 7 0 10 161 9 505 -1 278 1 509 5 513 10 10 249 140 261 141 7 1 9 -236 8 -696z m-3054 431 c198 -102 300 -156 571 -299 69 -36 158 -82 198 -103 l72 -36 0 -168 c0 -92 -2 -168 -4 -168 -3 0 -206 106 -453 234 -246 129 -456 238 -466 242 -16 6 -17 -12 -15 -332 l3 -338 150 -78 c83 -43 256 -133 385 -200 129 -67 272 -141 318 -165 l83 -43 2 -175 c1 -96 0 -175 -3 -175 -3 0 -88 44 -190 98 -102 54 -382 201 -622 327 l-438 230 3 579 2 578 85 49 c47 27 91 49 99 49 8 0 107 -48 220 -106z"/>
              <path d="M2745 4634 c-66 -40 -124 -75 -130 -77 -14 -7 14 -27 143 -101 l113 -66 109 65 c59 36 120 71 134 79 26 13 25 14 -91 83 -65 39 -127 75 -138 80 -16 8 -42 -4 -140 -63z"/>
              <path d="M2287 4388 c-76 -44 -136 -82 -135 -83 2 -2 65 -39 142 -84 l138 -81 117 70 c64 38 124 75 135 83 17 13 8 20 -119 95 -75 45 -138 82 -139 82 0 0 -63 -37 -139 -82z"/>
              <path d="M3162 4388 l-134 -80 94 -57 c51 -32 113 -69 138 -83 l45 -26 138 80 c75 44 135 83 132 88 -4 7 -272 161 -278 159 -1 0 -62 -36 -135 -81z"/>
              <path d="M2732 4139 c-73 -45 -132 -82 -130 -84 2 -1 62 -37 135 -79 l131 -77 134 77 c73 42 134 78 136 79 2 2 -249 155 -267 163 -4 1 -66 -34 -139 -79z"/>
            </g>
          </svg>
          <span style="font-family: 'Cormorant Garamond'; font-weight: 700; font-size: 20pt; color: ${colors.border}; letter-spacing: 3px; text-transform: uppercase;">ColabWize Platform</span>
        </div>
        <div class="header-text">${certificateTitle}</div>
      </div>

      <!-- Main Body -->
      <div class="content">
        <div class="recipient-name">${options.userName}</div>
        
        <div class="description">
          ${certificateDescription}
        </div>

        <div class="stats-row">
          <div class="stat-item">
            <div class="stat-value">Over ${hours} Hours</div>
            <div class="stat-label">Logged Time</div>
          </div>
          <div class="stat-item">
             <div class="stat-value">${stats.manualEditsCount.toLocaleString()}</div>
             <div class="stat-label">Total Revisions</div>
          </div>
           <div class="stat-item">
             <div class="stat-value">${stats.aiAssistedPercentage === 0 ? "0%" : stats.aiAssistedPercentage + "%"}</div>
             <div class="stat-label">Automated Content</div>
          </div>
        </div>
      </div>

      ${confidenceReport ? `
      <div class="confidence-grid">
        <div class="confidence-card">
          <div class="confidence-label">Overall Reliability</div>
          <div class="confidence-value">${reliabilityLabel} · ${reliabilityScore}</div>
          <div class="confidence-note">Evidence-backed confidence, not proof of authorship.</div>
        </div>
        <div class="confidence-card">
          <div class="confidence-label">Attribution Confidence</div>
          <div class="confidence-value">${confidenceReport.attributionConfidence.label} · ${confidenceReport.attributionConfidence.score}</div>
          <div class="confidence-note">${confidenceReport.evidenceSummary.serverObservedEvidence} server-observed evidence item(s).</div>
        </div>
        <div class="confidence-card">
          <div class="confidence-label">AI Transparency</div>
          <div class="confidence-value">${confidenceReport.aiAssistanceTransparency.label} · ${confidenceReport.aiAssistanceTransparency.score}</div>
          <div class="confidence-note">${confidenceReport.evidenceSummary.aiAssistedEvidence} AI-assisted evidence item(s).</div>
        </div>
      </div>
      ` : ""}

      <!-- Footer Section -->
      <div class="footer">
        <!-- Signature LEFT -->
        <div class="signature-block">
          <div class="signature-img">ColabWize Logic</div>
          <div class="signature-line"></div>
          <div class="signature-text">Authorized Signature</div>
          <div style="font-family: 'Courier New', monospace; font-size: 9pt; margin-top: 5px; color: ${colors.border}; font-weight: bold;"><strong>Certificate ID:</strong> ${certificateId}</div>
          <div style="font-family: 'Cormorant Garamond', serif; font-size: 9pt; color: ${colors.secondaryText}; margin-top: 2px;">Verify at: colabwize.com/verify</div>
        </div>

        <!-- Seal CENTER -->
        <div class="seal-container">
          <div class="ribbon ribbon-left"></div>
          <div class="ribbon ribbon-right"></div>
          <div class="seal">
            <div class="seal-inner">
               <span class="seal-text">Official<br>Semblance</span>
               <span class="seal-icon">★</span>
               <span class="seal-text">Verified<br>Integrity</span>
            </div>
          </div>
        </div>

        <!-- Date & QR RIGHT -->
        <div class="qr-container">
           ${qrCodeDataUrl
        ? `
           <div class="qr-box">
             <img src="${qrCodeDataUrl}" width="70" height="70" alt="QR" />
           </div>
           `
        : ""
      }
           <div class="qr-caption">Scan to Verify Online</div>
           <div style="margin-top: 5px; font-family: 'Cormorant Garamond', serif; font-size: 11pt; color: ${colors.secondaryText};"><strong>Date Issued:</strong> ${issueDate}</div>
        </div>
      </div>

    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Get certificate title based on type (Obsolete with new single title, but kept for interface compliance)
   */
  private static getCertificateTitle(type?: string): string {
    return "Certificate of Authorship and Academic Integrity";
  }

  /**
   * Get default description based on certificate type
   */
  private static getDefaultDescription(
    type: string | undefined,
    stats: any,
    userName: string,
    projectTitle: string
  ): string {
    const hours = Math.floor(stats.totalTimeInvestedMinutes / 60);

    // Default to the new detailed description logic for all types as requested for MVP uniformity
    return `This document certifies that <strong>${userName}</strong> has demonstrated genuine authorship of 
            "<strong>${projectTitle || "Untitled Project"}</strong>" through over <strong>${hours} hours</strong> of documented manual work 
        and <strong>${stats.manualEditsCount.toLocaleString()} tracked revisions</strong>, with <strong>${stats.aiAssistedPercentage}% detected automated content</strong>. 
            This certificate validates the process of creation, ensuring transparency and academic honesty.`;
  }

  /**
   * Convert HTML to PDF using Puppeteer (landscape orientation)
   */
  static async convertHTMLToPDF(html: string): Promise<Buffer> {
    let browser;
    try {
      browser = await this.launchBrowser();

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });

      const pdfBuffer = await page.pdf({
        format: "Letter",
        landscape: true, // THIS IS KEY - LANDSCAPE ORIENTATION
        printBackground: true,
        margin: {
          top: "0",
          right: "0",
          bottom: "0",
          left: "0",
        },
      });

      await browser.close();

      return Buffer.from(pdfBuffer);
    } catch (error: any) {
      if (browser) {
        await browser.close();
      }
      throw error;
    }
  }

  /**
   * Generate QR code as data URL
   */
  private static async generateQRCodeDataURL(url: string): Promise<string> {
    try {
      const qrDataUrl = await QRCode.toDataURL(url, {
        errorCorrectionLevel: "H",
        margin: 1,
        width: 200,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });

      return qrDataUrl;
    } catch (error: any) {
      logger.error("Error generating QR code", { error: error.message });
      throw error;
    }
  }

  /**
   * Generate preview image (PNG) from certificate HTML
   */
  static async generatePreviewImage(html: string): Promise<Buffer> {
    let browser;
    try {
      browser = await this.launchBrowser();

      const page = await browser.newPage();

      // Set viewport to match certificate dimensions (landscape letter size)
      await page.setViewport({
        width: 1056, // 11 inches at 96 DPI
        height: 816, // 8.5 inches at 96 DPI
      });

      await page.setContent(html, { waitUntil: "networkidle0" });

      const screenshot = await page.screenshot({
        type: "png",
        fullPage: false,
      });

      await browser.close();

      return Buffer.from(screenshot);
    } catch (error: any) {
      if (browser) {
        await browser.close();
      }
      logger.error("Error generating preview image", { error: error.message });
      throw error;
    }
  }


  /**
   * Helper to launch browser with fallbacks
   */
  /**
   * Helper to launch browser with fallbacks
   */
  private static async launchBrowser() {
    // Dynamic import to prevent startup blocking
    const puppeteerModule = await import("puppeteer");
    const puppeteer = puppeteerModule.default;

    const launchArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none"
    ];

    try {
      logger.info("Puppeteer configuration", {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        defaultExecutablePath: puppeteer.executablePath()
      });
      // 1. Try default bundled path or ENV
      return await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
        args: launchArgs,
      });
    } catch (error) {
      logger.warn("Default Puppeteer launch failed, checking system paths...", { error });

      // 2. Try common system paths (Windows)
      const systemPaths = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Users\\" + (process.env.USERNAME || "Admin") + "\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"
      ];

      for (const candidatePath of systemPaths) {
        if (fs.existsSync(candidatePath)) {
          logger.info(`Found system Chrome at ${candidatePath}, attempting launch...`);
          try {
            return await puppeteer.launch({
              headless: true,
              executablePath: candidatePath,
              args: launchArgs,
            });
          } catch (e) {
            logger.warn(`Failed to launch system Chrome at ${candidatePath}`, e);
          }
        }
      }

      // 3. Try Puppeteer cache under the user's home directory
      const home = process.env.HOME;
      if (home) {
        const puppeteerChromeRoot = path.join(home, ".cache", "puppeteer", "chrome");
        if (fs.existsSync(puppeteerChromeRoot)) {
          for (const version of fs.readdirSync(puppeteerChromeRoot)) {
            const candidatePath = path.join(
              puppeteerChromeRoot,
              version,
              "chrome-linux64",
              "chrome"
            );

            if (fs.existsSync(candidatePath)) {
              logger.info(`Found Puppeteer Chrome at ${candidatePath}, attempting launch...`);
              try {
                return await puppeteer.launch({
                  headless: true,
                  executablePath: candidatePath,
                  args: launchArgs,
                });
              } catch (e) {
                logger.warn(`Failed to launch Puppeteer Chrome at ${candidatePath}`, e);
              }
            }
          }
        }
      }

      // 3. Try without executablePath (let Puppeteer search in path)
      try {
        logger.info("Retrying with auto-detected path...");
        return await puppeteer.launch({
          headless: true,
          args: launchArgs,
        });
      } catch (finalError) {
        logger.error("All browser launch attempts failed.");
        throw finalError;
      }
    }
  }
}
