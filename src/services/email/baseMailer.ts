import logger from "../../monitoring/logger";
import { getResendClient } from "./resendClient";
import { SENDER_IDENTITIES, REPLY_TO, EmailOptions } from "./emailConfig";

/**
 * Base function to send an email using Resend with retry logic.
 * Centralizes common parameters like reply_to and handles errors.
 */
export async function sendEmail({
  from,
  to,
  subject,
  html,
  text,
  attachments,
}: EmailOptions) {
  const resend = await getResendClient();
  
  if (!resend) {
    const errorMsg = "Resend client not initialized - cannot send email";
    logger.error(errorMsg);
    return { success: false, error: new Error(errorMsg) };
  }

  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000; // 1 second

  let lastError: any = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`Attempt ${attempt}: Sending ${from} email to recipient`, {
        subject,
        timestamp: new Date().toISOString(),
      });

      const { data, error } = await resend.emails.send({
        from: SENDER_IDENTITIES[from],
        to,
        subject,
        html,
        text: text || "This email requires an HTML viewer.",
        attachments,
        replyTo: REPLY_TO,
      });

      if (error) {
        lastError = error;
        logger.warn(`Resend API attempt ${attempt} failed:`, {
          errorType: (error as any).name || "APIError",
          from,
          subject,
        });

        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
          continue;
        }
        
        return { success: false, error };
      }

      logger.info("Email sent successfully via Resend", {
        messageId: data?.id,
        from,
        subject,
      });

      return { success: true, data };
    } catch (error) {
      lastError = error;
      logger.error(`Unexpected error in sendEmail (attempt ${attempt}):`, {
        error: error instanceof Error ? error.message : "Unknown error",
        from,
        subject,
      });

      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        continue;
      }
    }
  }

  return { success: false, error: lastError };
}
