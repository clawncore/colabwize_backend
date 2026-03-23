import express, { Router } from "express";
import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";

const router: Router = express.Router();

const PAGE_SHELL = (content: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Preferences | ColabWize</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Arial', sans-serif; background: #f3f4f6; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); max-width: 520px; width: 100%; padding: 48px 40px; text-align: center; }
    .logo { height: 44px; margin-bottom: 28px; }
    h1 { font-size: 22px; color: #111827; margin-bottom: 12px; font-weight: 700; }
    p { font-size: 14px; color: #6b7280; line-height: 1.7; margin-bottom: 16px; }
    .email-badge { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 10px 20px; display: inline-block; font-size: 14px; font-weight: bold; color: #0369a1; margin: 16px 0 24px 0; }
    .info-box { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px; text-align: left; margin-bottom: 28px; }
    .info-box h3 { font-size: 14px; font-weight: 700; color: #374151; margin-bottom: 10px; }
    .info-box ul { list-style: none; padding: 0; }
    .info-box ul li { font-size: 13px; color: #6b7280; padding: 4px 0; display: flex; align-items: center; gap: 8px; }
    .info-box ul li::before { content: "✓"; color: #10b981; font-weight: bold; }
    .info-box .will-not { color: #ef4444; }
    .info-box .will-not::before { content: "✗ "; color: #ef4444; font-weight: bold; }
    .btn-confirm { background: #ef4444; color: white; border: none; padding: 14px 32px; border-radius: 10px; font-size: 15px; font-weight: bold; cursor: pointer; width: 100%; transition: background 0.2s; }
    .btn-confirm:hover { background: #dc2626; }
    .btn-back { background: none; border: 1px solid #d1d5db; color: #6b7280; padding: 12px 32px; border-radius: 10px; font-size: 14px; cursor: pointer; width: 100%; margin-top: 12px; transition: all 0.2s; }
    .btn-back:hover { background: #f9fafb; }
    .success-icon { font-size: 48px; margin-bottom: 16px; }
    .divider { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    .footer-note { font-size: 11px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="card">
    <img src="https://colabwize.com/email_logo.png" alt="ColabWize" class="logo">
    ${content}
  </div>
</body>
</html>`;

/**
 * @route   GET /api/unsubscribe
 * @desc    Show email preferences info page before confirming unsubscribe
 * @access  Public
 */
router.get("/", async (req, res) => {
  try {
    const email = req.query.email as string;

    if (!email) {
      return res.status(400).send(PAGE_SHELL(`<h1>Invalid Link</h1><p>This unsubscribe link is missing required information. Please use the link from your email.</p>`));
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // If already unsubscribed, show confirmation
    if (user?.unsubscribed_from_marketing) {
      return res.send(PAGE_SHELL(`
        <div class="success-icon">✅</div>
        <h1>You're already opted out</h1>
        <div class="email-badge">${email}</div>
        <p>This email address is already removed from our broadcast list. You will not receive any marketing emails from ColabWize.</p>
        <hr class="divider">
        <p class="footer-note">Note: Essential account emails (security alerts, OTPs) are not affected.</p>
        <a href="https://colabwize.com"><button class="btn-back" style="margin-top: 20px;">Return to ColabWize</button></a>
      `));
    }

    // Show info page before confirming
    res.send(PAGE_SHELL(`
      <h1>Email Preferences</h1>
      <div class="email-badge">${email}</div>

      <div class="info-box">
        <h3>If you unsubscribe, you will no longer receive:</h3>
        <ul>
          <li>Platform news and feature announcements</li>
          <li>Research tips and tutorials</li>
          <li>Promotional offers and upgrades</li>
          <li>Mass broadcast communications from our team</li>
        </ul>
      </div>

      <div class="info-box">
        <h3>You will still receive essential emails:</h3>
        <ul>
          <li>Account verification codes (OTP)</li>
          <li>Password reset instructions</li>
          <li>Security alerts &amp; login notifications</li>
          <li>Direct support replies</li>
        </ul>
      </div>

      <form method="POST" action="/api/unsubscribe?email=${encodeURIComponent(email)}">
        <button type="submit" class="btn-confirm">Confirm Unsubscribe</button>
      </form>
      <a href="https://colabwize.com">
        <button class="btn-back">Keep my subscription</button>
      </a>

      <hr class="divider">
      <p class="footer-note">You can contact <a href="mailto:support@colabwize.com" style="color: #0ea5e9;">support@colabwize.com</a> at any time if you need help managing your preferences.</p>
    `));
  } catch (error: any) {
    logger.error("Unsubscribe Page Error:", error);
    res.status(500).send(PAGE_SHELL(`<h1>System Error</h1><p>Something went wrong. Please try again or contact support.</p>`));
  }
});

/**
 * @route   POST /api/unsubscribe
 * @desc    Confirm the unsubscribe action and store it in the database
 * @access  Public
 */
router.post("/", async (req, res) => {
  try {
    const email = req.query.email as string;

    if (!email) {
      return res.status(400).send(PAGE_SHELL(`<h1>Invalid Request</h1><p>Missing email parameter.</p>`));
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Silently succeed even for unregistered emails (prevent enumeration)
    if (user) {
      await prisma.user.update({
        where: { email },
        data: { unsubscribed_from_marketing: true }
      });
      logger.info(`User unsubscribed from marketing: ${email}`);
    }

    res.send(PAGE_SHELL(`
      <div class="success-icon">👋</div>
      <h1>You've been unsubscribed</h1>
      <div class="email-badge">${email}</div>
      <p>We've successfully removed you from our broadcast list. You won't receive any more marketing emails from ColabWize.</p>
      <p>We're sorry to see you go. If you have feedback on how we can improve our communications, we'd love to hear it at <a href="mailto:support@colabwize.com" style="color: #0ea5e9;">support@colabwize.com</a>.</p>
      <hr class="divider">
      <p class="footer-note">Essential account emails (security, OTP) are unaffected by this setting.</p>
      <a href="https://colabwize.com"><button class="btn-back" style="margin-top: 20px;">Return to ColabWize</button></a>
    `));
  } catch (error: any) {
    logger.error("Unsubscribe Confirm Error:", error);
    res.status(500).send(PAGE_SHELL(`<h1>System Error</h1><p>Failed to process your request. Please try again.</p>`));
  }
});

import { sendEmail } from "../services/email/baseMailer";

/**
 * @route   POST /api/unsubscribe/confirm
 * @desc    JSON endpoint for the React frontend to confirm unsubscribe with survey feedback
 * @access  Public
 */
router.post("/confirm", async (req, res) => {
  try {
    const { email, reasons, feedback } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: "Missing email" });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Silent success to prevent email enumeration
      return res.json({ success: true, alreadyUnsubscribed: false });
    }

    const alreadyUnsubscribed = user.unsubscribed_from_marketing;

    // 1. Mark as unsubscribed in DB
    if (!alreadyUnsubscribed) {
      await prisma.user.update({
        where: { email },
        data: { unsubscribed_from_marketing: true }
      });
      logger.info(`[Unsubscribe] User opted out: ${email}`);
    }

    // 2. Forward feedback to Support Pipeline (support@colabwize.com)
    if (reasons?.length > 0 || feedback?.trim()) {
      const reasonText = reasons?.join(", ") || "No specific reason selected";
      const messageBody = feedback?.trim() || "No additional comments";

      await sendEmail({
        from: "MARKETING",
        to: "support@colabwize.com",
        subject: `Sad to see you go: Unsubscribe Feedback from ${email}`,
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h2 style="color: #111827;">New Unsubscribe Feedback</h2>
            <p><strong>User:</strong> ${email}</p>
            <p><strong>Reasons:</strong> ${reasonText}</p>
            <div style="margin-top: 16px; padding: 16px; background: #f8fafc; border-radius: 8px;">
              <strong>Comments:</strong><br/>
              ${messageBody.replace(/\n/g, '<br/>')}
            </div>
            <p style="margin-top: 24px; font-size: 12px; color: #64748b;">This feedback was automatically forwarded from the Unsubscribe Page.</p>
          </div>
        `,
        text: `New Unsubscribe Feedback\nUser: ${email}\nReasons: ${reasonText}\nComments: ${messageBody}`
      });
      
      logger.info(`[Unsubscribe] Feedback sent to support for: ${email}`);
    }

    res.json({ success: true, alreadyUnsubscribed });
  } catch (error: any) {
    logger.error("Unsubscribe Confirm Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
