import logger from "../monitoring/logger";
import { AuthorshipReportService } from "./authorshipReportService";
import QRCode from "qrcode";
import puppeteer from "puppeteer";
import { config } from "../config/env";

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

    // Format hours for description
    const hours = Math.floor(stats.totalTimeInvestedMinutes / 60);

    // Logic for automated content text
    const automatedContentText =
      stats.aiAssistedPercentage === 0
        ? "no automated content detected by the ColabWize platform"
        : `${stats.aiAssistedPercentage}% detected automated content`;

    // Exact requested phrasing
    const certificateDescription =
      options.description ||
      `<em>This document certifies that</em> the above-named individual has demonstrated genuine authorship of 
       '<strong>${options.projectTitle || "Untitled Project"}</strong>' through over <strong>${hours} hours</strong> of documented manual work 
       and <strong>${stats.manualEditsCount.toLocaleString()} tracked revisions</strong>, with <strong>${stats.automatedContentDetectText || automatedContentText}</strong>. 
       This certificate validates the process of creation, ensuring transparency and academic honesty.`;

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
      font-size: 36pt;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: ${colors.border};
      margin-bottom: 5px;
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
      margin-bottom: 15px;
      position: relative;
      z-index: 1;
    }

    .recipient-name {
      font-family: 'Cormorant Garamond', serif;
      font-size: 42pt;
      font-weight: 700;
      color: ${colors.border};
      margin: 10px 0 15px 0;
      text-transform: none;
    }

    .description {
      font-family: 'Cormorant Garamond', serif;
      font-size: 14pt;
      line-height: 1.5;
      color: ${colors.secondaryText};
      max-width: 90%;
      margin: 0 auto 20px auto;
    }

    /* Stats */
    .stats-row {
      display: flex;
      justify-content: center;
      gap: 60px;
      margin-top: 10px;
      border-top: 1px solid #CCC;
      border-bottom: 1px solid #CCC;
      padding: 10px 0;
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
      font-size: 18pt;
      font-weight: 700;
      color: ${colors.border};
    }

    .stat-label {
      font-family: 'Cormorant Garamond', serif;
      font-size: 12pt;
      color: ${colors.secondaryText};
      margin-top: 4px;
      font-weight: 700; /* BOLD as requested */
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Footer */
    .footer {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      padding-top: 10px;
      position: relative;
      z-index: 1;
    }

    .signature-block {
      text-align: left;
      width: 280px;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
    }

    .signature-line {
      border-bottom: 1px solid ${colors.border};
      margin-bottom: 6px;
      width: 100%;
    }

    .signature-text {
      font-family: 'Cormorant Garamond', serif;
      font-size: 11pt;
      font-weight: 600;
      color: ${colors.secondaryText};
    }
    
    .signature-img {
       font-family: 'Brush Script MT', cursive;
       font-size: 20pt;
       margin-bottom: 2px;
       color: ${colors.border};
    }

    /* ROSETTE SEAL STYLES */
    .seal-container {
      position: absolute;
      bottom: 25px; /* Moved up slightly to make room for ribbons */
      left: 50%;
      transform: translateX(-50%);
      text-align: center;
      z-index: 10;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    
    /* The main rosette shape */
    .seal {
      width: 110px;
      height: 110px;
      border-radius: 50%;
      background: radial-gradient(ellipse at center, #FFD700 0%, #B8860B 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      z-index: 2;
      /* Scalloped edge effect using thick dotted border */
      border: 8px dotted #DAA520; 
      box-shadow: 0 4px 8px rgba(0,0,0,0.4);
    }
    
    /* Ribbons */
    .ribbon {
      position: absolute;
      top: 60px;
      width: 30px;
      height: 70px;
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
      font-size: 9pt;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      text-align: center;
      line-height: 1.1;
      text-shadow: 0px 1px 0px rgba(255,255,255,0.4);
    }
    
    .seal-icon {
       font-size: 20px;
       margin: 1px 0;
       color: ${colors.border};
       text-shadow: 0px 1px 0px rgba(255,255,255,0.4);
    }

    /* QR Code */
    .qr-container {
      width: 250px;
      text-align: right;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      justify-content: flex-end;
    }

    .qr-box {
      border: 1px solid ${colors.accent};
      padding: 5px;
      background: white;
      display: inline-block;
      margin-bottom: 5px;
    }
    
    .qr-box img {
        display: block;
    }

    .qr-caption {
      font-family: 'Cormorant Garamond', serif;
      font-size: 10pt;
      color: ${colors.border};
      font-weight: 600;
    }

    /* Legal Footer */
    .legal-footer {
      position: absolute;
      bottom: 2px;
      left: 0;
      width: 100%;
      text-align: center;
      font-family: 'Cormorant Garamond', serif;
      font-size: 9pt;
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
        <div class="logo-section">
             <span style="font-family: 'Cormorant Garamond'; font-weight: 700; font-size: 22pt; color: ${colors.border}; letter-spacing: 3px; text-transform: uppercase;">ColabWize Platform</span>
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
           ${
             qrCodeDataUrl
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

      <!-- Legal Disclaimer -->
      <div class="legal-footer">
        This certificate attests to activity tracked within the ColabWize platform only and does not guarantee institutional acceptance. For full terms: colabwize.com/terms
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
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

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
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

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
}
