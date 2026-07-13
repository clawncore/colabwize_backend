"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const baseMailer_1 = require("../services/email/baseMailer");
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Load environment variables from backend root
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, "../../.env") });
async function testResend() {
    console.log("🚀 Starting Resend Connectivity Test...");
    try {
        const result = await (0, baseMailer_1.sendEmail)({
            from: "WELCOME",
            to: "simbisai@colabwize.com",
            subject: "Resend Connectivity Test - ColabWize Admin",
            html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #38bdf8; border-radius: 12px; background: #f0f9ff;">
          <h2 style="color: #0ea5e9;">Connectivity Status: ACTIVE</h2>
          <p>This is a test email from the ColabWize Admin debugging suite to verify Resend is working before deployment.</p>
          <hr style="border: none; border-top: 1px solid #bae6fd; margin: 20px 0;">
          <small style="color: #64748b;">Timestamp: ${new Date().toISOString()}</small>
        </div>
      `,
            text: "Resend Connectivity Test: ACTIVE. Deployment ready."
        });
        if (result.success) {
            console.log("✅ SUCCESS: Email delivered. Resend API is active and reporting nominal capacity.");
            console.log("Message ID:", result.data?.id);
        }
        else {
            console.error("❌ FAILURE: Could not deliver email.");
            console.error("Error Details:", result.error);
        }
    }
    catch (error) {
        console.error("❌ CRITICAL ERROR during test:", error);
    }
}
testResend();
