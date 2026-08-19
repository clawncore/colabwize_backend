import { SENDER_IDENTITIES, REPLY_TO } from "./src/services/email/emailConfig";
import { EmailService } from "./src/services/emailService";

async function verifyConfig() {
  console.log("--- Email Configuration Verification ---");
  console.log("REPLY_TO:", REPLY_TO);
  console.log("SENDER_IDENTITIES:", JSON.stringify(SENDER_IDENTITIES, null, 2));
  
  const expectedIdentities = ["VERIFY", "SECURITY", "NOTIFICATIONS", "BILLING"];
  const missingIdentities = expectedIdentities.filter(id => !(id in SENDER_IDENTITIES));
  
  if (missingIdentities.length > 0) {
    console.error("❌ Missing identities:", missingIdentities);
  } else {
    console.log("✅ All required identities present.");
  }

  console.log("\n--- Facade Check ---");
  const methods = Object.keys(EmailService);
  console.log("EmailService Methods Count:", methods.length);
  
  const requiredMethods = ["sendOTPEmail", "sendSubscriptionConfirmationEmail", "sendNotificationEmail"];
  const isValid = requiredMethods.every(method => typeof (EmailService as any)[method] === "function");
  
  if (isValid) {
    console.log("✅ Key facade methods are correctly mapped.");
  } else {
    console.error("❌ Facade mapping failed.");
  }
}

verifyConfig().catch(console.error);
