import { sendOTPEmail } from "./src/services/email/authEmails";
import { sendNotificationEmail } from "./src/services/email/notificationEmails";
import { sendPaymentSuccessEmail } from "./src/services/email/billingEmails";

async function runLiveTest() {
  const testEmail = process.argv[2];

  if (!testEmail) {
    console.error("Usage: npx tsx live-email-test.ts <your-email@example.com>");
    process.exit(1);
  }

  console.log(`\n🚀 Starting Live Email Test for: ${testEmail}\n`);

  try {
    // 1. Test AUTH (VERIFY sender)
    console.log("Testing AUTH (Sender: VERIFY)...");
    const authResult = await sendOTPEmail(testEmail, "123456", "Test User");
    console.log(authResult ? "✅ AUTH email sent successfully." : "❌ AUTH email failed.");

    // 2. Test NOTIFICATIONS (NOTIFICATIONS sender)
    console.log("\nTesting NOTIFICATIONS (Sender: NOTIFICATIONS)...");
    const notificationResult = await sendNotificationEmail(
      testEmail,
      "Test User",
      "Live Test Notification",
      "This is a test notification from the new modular email system.",
      "test"
    );
    console.log(notificationResult ? "✅ NOTIFICATION email sent successfully." : "❌ NOTIFICATION email failed.");

    // 3. Test BILLING (BILLING sender)
    console.log("\nTesting BILLING (Sender: BILLING)...");
    const billingResult = await sendPaymentSuccessEmail(
      testEmail,
      "Test User",
      "Pro Plan",
      29.00,
      "test_transaction_id"
    );
    console.log(billingResult ? "✅ BILLING email sent successfully." : "❌ BILLING email failed.");

    console.log("\n--- Live Test Summary ---");
    console.log("Please check your inbox (and spam folder) for the following:");
    console.log("1. OTP Email from: ColabWize Verify <verify@colabwize.com>");
    console.log("2. Notification from: ColabWize Notifications <notifications@colabwize.com>");
    console.log("3. Payment Success from: ColabWize Billing <billing@colabwize.com>");
    console.log("\nVerify SPF/DKIM/DMARC in 'Show Original' view in Gmail.");

  } catch (error) {
    console.error("\n❌ Live test encountered an error:", error);
    process.exit(1);
  }
}

runLiveTest().catch(console.error);
