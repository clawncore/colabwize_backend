"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const contactService_1 = require("../../services/contactService");
const requestHelpers_1 = require("../../utils/requestHelpers");
const recaptcha_1 = require("../../utils/recaptcha");
// POST /api/contact - Handle contact form submission
async function POST(request) {
    try {
        const body = await request.json();
        const name = (0, requestHelpers_1.getSafeString)(body.name);
        const email = (0, requestHelpers_1.getSafeString)(body.email);
        const subject = (0, requestHelpers_1.getSafeString)(body.subject);
        const message = (0, requestHelpers_1.getSafeString)(body.message);
        const token = (0, requestHelpers_1.getSafeString)(body.token);
        // reCAPTCHA verification - fail-open if token is missing (for Brave/Ad-blockers)
        if (token) {
            const recaptchaResult = await (0, recaptcha_1.verifyRecaptcha)(token);
            if (!recaptchaResult.success) {
                return new Response(JSON.stringify({
                    error: recaptchaResult.message ||
                        "Automated activity detected. Please try again.",
                }), { status: 403, headers: { "Content-Type": "application/json" } });
            }
        }
        else {
            console.warn("[reCAPTCHA] Token missing in contact form, bypassing (fail-open).");
        }
        // Validate required fields
        if (!name || !email || !subject || !message) {
            return new Response(JSON.stringify({
                error: "All fields are required: name, email, subject, message",
            }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        // Get IP address and user agent from request
        const ip_address = request.headers.get("x-forwarded-for") ||
            request.headers.get("x-real-ip") ||
            "unknown";
        const user_agent = request.headers.get("user-agent") || "unknown";
        // Process the contact form submission
        const result = await contactService_1.ContactService.handleContactSubmission({
            name: name,
            email: email,
            subject: subject,
            message: message,
            ip_address,
            user_agent,
        });
        return new Response(JSON.stringify({
            message: "Your message has been sent successfully",
            result,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    catch (error) {
        console.error("Error processing contact form:", error);
        return new Response(JSON.stringify({
            error: error.message || "Failed to process contact form submission",
        }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}
