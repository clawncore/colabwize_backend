"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSubscriptionConfirmationEmail = sendSubscriptionConfirmationEmail;
exports.sendPaymentSuccessEmail = sendPaymentSuccessEmail;
exports.sendPaymentFailedEmail = sendPaymentFailedEmail;
exports.sendInvoiceAvailableEmail = sendInvoiceAvailableEmail;
exports.sendPlanChangeEmail = sendPlanChangeEmail;
const baseMailer_1 = require("./baseMailer");
const emailLayout_1 = require("./emailLayout");
/**
 * Sends a subscription confirmation email.
 */
async function sendSubscriptionConfirmationEmail(to, fullName, planName, amount, nextBillingDate, transactionId) {
    const content = `
    <p>Hello ${fullName},</p>
    <p>Thank you for subscribing to ColabWize ${planName} plan! You're now one step closer to protecting your academic work and ensuring your submissions are defensible.</p>
    
    <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
      <h2 style="color: #1e40af; margin-top: 0;">Subscription Details</h2>
      <p style="margin: 5px 0;"><strong>Plan:</strong> ${planName}</p>
      <p style="margin: 5px 0;"><strong>Amount:</strong> $${amount.toFixed(2)}</p>
      <p style="margin: 5px 0;"><strong>Next Billing Date:</strong> ${nextBillingDate}</p>
      <p style="margin: 5px 0;"><strong>Transaction ID:</strong> ${transactionId}</p>
    </div>
    
    <p style="font-size: 14px;">You can manage your subscription in your account settings.</p>
  `;
    const html = (0, emailLayout_1.buildEmailHtml)({
        title: "Subscription Confirmed",
        content,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
        from: "BILLING",
        to,
        subject: `ColabWize ${planName} Plan Subscription Confirmed`,
        html,
        text: `Hello ${fullName},\n\nThank you for subscribing to the ColabWize ${planName} plan!\n\nAmount: $${amount.toFixed(2)}\nNext Billing Date: ${nextBillingDate}\nTransaction ID: ${transactionId}\n\nColabWize Team`,
    });
    return success;
}
/**
 * Sends a payment success notification.
 */
async function sendPaymentSuccessEmail(to, fullName, planName, amount, transactionId) {
    const content = `
    <p>Hello ${fullName},</p>
    <p>Your payment of $${amount.toFixed(2)} for the ${planName} plan has been processed successfully.</p>
    
    <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
      <h2 style="color: #1e40af; margin-top: 0;">Payment Details</h2>
      <p style="margin: 5px 0;"><strong>Plan:</strong> ${planName}</p>
      <p style="margin: 5px 0;"><strong>Amount:</strong> $${amount.toFixed(2)}</p>
      <p style="margin: 5px 0;"><strong>Transaction ID:</strong> ${transactionId}</p>
    </div>
    
    <p style="font-size: 14px;">Thank you for choosing ColabWize!</p>
  `;
    const html = (0, emailLayout_1.buildEmailHtml)({
        title: "Payment Successful",
        content,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
        from: "BILLING",
        to,
        subject: `Payment successful \u2014 $${amount.toFixed(2)} received`,
        html,
        text: `Hello ${fullName},\n\nYour payment of $${amount.toFixed(2)} for the ${planName} plan has been processed successfully.\n\nTransaction ID: ${transactionId}\n\nColabWize Team`,
    });
    return success;
}
/**
 * Sends a payment failure notification.
 */
async function sendPaymentFailedEmail(to, fullName, planName, amount) {
    const content = `
    <p>Hello ${fullName},</p>
    <p>We're sorry, but your payment of $${amount.toFixed(2)} for the ${planName} plan has failed.</p>
    <p>Please update your payment method in your account settings to continue using ColabWize.</p>
    <p style="font-size: 14px;">If you need assistance, please contact our support team.</p>
  `;
    const html = (0, emailLayout_1.buildEmailHtml)({
        title: "Payment Failed",
        content,
        ctaText: "Update Payment Method",
        ctaUrl: "http://app.colabwize.com/dashboard/billing",
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
        from: "BILLING",
        to,
        subject: `ColabWize Payment Failed - $${amount.toFixed(2)}`,
        html,
        text: `Hello ${fullName},\n\nYour payment of $${amount.toFixed(2)} for the ${planName} plan has failed. Please update your payment method.\n\nColabWize Team`,
    });
    return success;
}
/**
 * Sends an invoice availability notification.
 */
async function sendInvoiceAvailableEmail(to, fullName, planName, amount, invoiceUrl) {
    const content = `
    <p>Hello ${fullName},</p>
    <p>Your invoice for $${amount.toFixed(2)} for the ${planName} plan is now available.</p>
    <p style="font-size: 14px;">Thank you for choosing ColabWize!</p>
  `;
    const html = (0, emailLayout_1.buildEmailHtml)({
        title: "Invoice Available",
        content,
        ctaText: "View Invoice",
        ctaUrl: invoiceUrl,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
        from: "BILLING",
        to,
        subject: `ColabWize Invoice Available - $${amount.toFixed(2)}`,
        html,
        text: `Hello ${fullName},\n\nYour invoice for $${amount.toFixed(2)} for the ${planName} plan is now available.\n\nView it here: ${invoiceUrl}\n\nColabWize Team`,
    });
    return success;
}
/**
 * Sends a plan change notification.
 */
async function sendPlanChangeEmail(to, fullName, oldPlan, newPlan, effectiveDate, newFeatures) {
    const isUpgrade = ["free", "student", "researcher"].indexOf(newPlan.toLowerCase()) >
        ["free", "student", "researcher"].indexOf(oldPlan.toLowerCase());
    const subject = isUpgrade
        ? `🎉 Plan Upgraded to ${newPlan}!`
        : `Plan Changed to ${newPlan}`;
    const title = `${isUpgrade ? "🎉" : "📝"} Plan ${isUpgrade ? "Upgraded" : "Changed"}!`;
    const content = `
    <p>Hello ${fullName},</p>
    <p>Your subscription plan has been ${isUpgrade ? "upgraded" : "changed"} from <strong>${oldPlan}</strong> to <strong>${newPlan}</strong>.</p>
    
    <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
      <h2 style="color: #1e40af; margin-top: 0; font-size: 18px;">${isUpgrade ? "New Features Available" : "Plan Details"}</h2>
      <ul style="margin: 10px 0; padding-left: 20px; color: #333;">
        ${newFeatures.map((feature) => `<li style="margin: 8px 0;">${feature}</li>`).join("")}
      </ul>
      <p style="margin: 15px 0 5px 0; color: #666;"><strong>Effective Date:</strong> ${effectiveDate}</p>
    </div>
    
    <p style="font-size: 14px;">Thank you for choosing ColabWize!</p>
  `;
    const html = (0, emailLayout_1.buildEmailHtml)({
        title,
        content,
        ctaText: "Explore Your New Features",
        ctaUrl: "http://app.colabwize.com/dashboard",
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
        from: "BILLING",
        to,
        subject,
        html,
        text: `Hello ${fullName},\n\nYour subscription plan has been changed to ${newPlan}.\n\nEffective Date: ${effectiveDate}\n\nColabWize Team`,
    });
    return success;
}
