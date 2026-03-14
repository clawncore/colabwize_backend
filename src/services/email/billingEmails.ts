import { sendEmail } from "./baseMailer";

/**
 * Sends a subscription confirmation email.
 */
export async function sendSubscriptionConfirmationEmail(
  to: string,
  fullName: string,
  planName: string,
  amount: number,
  nextBillingDate: string,
  transactionId: string,
): Promise<boolean> {
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">Subscription Confirmed</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Thank you for subscribing to ColabWize ${planName} plan! You're now one step closer to protecting your academic work and ensuring your submissions are defensible.
        </p>
        
        <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
          <h2 style="color: #1e40af; margin-top: 0;">Subscription Details</h2>
          <p style="margin: 5px 0;"><strong>Plan:</strong> ${planName}</p>
          <p style="margin: 5px 0;"><strong>Amount:</strong> $${amount.toFixed(2)}</p>
          <p style="margin: 5px 0;"><strong>Next Billing Date:</strong> ${nextBillingDate}</p>
          <p style="margin: 5px 0;"><strong>Transaction ID:</strong> ${transactionId}</p>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          You can manage your subscription in your account settings.
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team - Your Academic Integrity Partner
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "BILLING",
    to,
    subject: `ColabWize ${planName} Plan Subscription Confirmed`,
    html,
  });

  return success;
}

/**
 * Sends a payment success notification.
 */
export async function sendPaymentSuccessEmail(
  to: string,
  fullName: string,
  planName: string,
  amount: number,
  transactionId: string,
): Promise<boolean> {
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">Payment Successful</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Your payment of $${amount.toFixed(2)} for the ${planName} plan has been processed successfully.
        </p>
        
        <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
          <h2 style="color: #1e40af; margin-top: 0;">Payment Details</h2>
          <p style="margin: 5px 0;"><strong>Plan:</strong> ${planName}</p>
          <p style="margin: 5px 0;"><strong>Amount:</strong> $${amount.toFixed(2)}</p>
          <p style="margin: 5px 0;"><strong>Transaction ID:</strong> ${transactionId}</p>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          Thank you for choosing ColabWize!
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team - Your Academic Integrity Partner
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "BILLING",
    to,
    subject: `ColabWize Payment Successful - $${amount.toFixed(2)}`,
    html,
  });

  return success;
}

/**
 * Sends a payment failure notification.
 */
export async function sendPaymentFailedEmail(
  to: string,
  fullName: string,
  planName: string,
  amount: number,
): Promise<boolean> {
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">Payment Failed</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          We're sorry, but your payment of $${amount.toFixed(2)} for the ${planName} plan has failed.
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Please update your payment method in your account settings to continue using ColabWize.
        </p>
        
        <div style="margin: 30px 0;">
          <a href="http://app.colabwize.com/dashboard/billing" style="background-color: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Update Payment Method
          </a>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          If you need assistance, please contact our support team.
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team - Your Academic Integrity Partner
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "BILLING",
    to,
    subject: `ColabWize Payment Failed - $${amount.toFixed(2)}`,
    html,
  });

  return success;
}

/**
 * Sends an invoice availability notification.
 */
export async function sendInvoiceAvailableEmail(
  to: string,
  fullName: string,
  planName: string,
  amount: number,
  invoiceUrl: string,
): Promise<boolean> {
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">Invoice Available</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Your invoice for $${amount.toFixed(2)} for the ${planName} plan is now available.
        </p>
        
        <div style="margin: 30px 0;">
          <a href="${invoiceUrl}" style="background-color: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            View Invoice
          </a>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          Thank you for choosing ColabWize!
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team - Your Academic Integrity Partner
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "BILLING",
    to,
    subject: `ColabWize Invoice Available - $${amount.toFixed(2)}`,
    html,
  });

  return success;
}

/**
 * Sends a plan change notification.
 */
export async function sendPlanChangeEmail(
  to: string,
  fullName: string,
  oldPlan: string,
  newPlan: string,
  effectiveDate: string,
  newFeatures: string[],
): Promise<boolean> {
  const isUpgrade =
    ["free", "student", "researcher"].indexOf(newPlan.toLowerCase()) >
    ["free", "student", "researcher"].indexOf(oldPlan.toLowerCase());

  const subject = isUpgrade
    ? `🎉 Plan Upgraded to ${newPlan}!`
    : `Plan Changed to ${newPlan}`;

  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">${isUpgrade ? "🎉" : "📝"} Plan ${isUpgrade ? "Upgraded" : "Changed"}!</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Your subscription plan has been ${isUpgrade ? "upgraded" : "changed"} from <strong>${oldPlan}</strong> to <strong>${newPlan}</strong>.
        </p>
        
        <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
          <h2 style="color: #1e40af; margin-top: 0; font-size: 18px;">${isUpgrade ? "New Features Available" : "Plan Details"}</h2>
          <ul style="margin: 10px 0; padding-left: 20px; color: #333;">
            ${newFeatures.map((feature) => `<li style="margin: 8px 0;">${feature}</li>`).join("")}
          </ul>
          <p style="margin: 15px 0 5px 0; color: #666;"><strong>Effective Date:</strong> ${effectiveDate}</p>
        </div>
        
        <div style="margin: 30px 0; text-align: center;">
          <a href="http://app.colabwize.com/dashboard" style="background-color: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Explore Your New Features
          </a>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          Thank you for choosing ColabWize!
        </p>
        
        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team - Your Academic Integrity Partner
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "BILLING",
    to,
    subject,
    html,
  });

  return success;
}
