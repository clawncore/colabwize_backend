import { Resend } from "resend";
import { SecretsService } from "../secrets-service";
import logger from "../../monitoring/logger";

let resend: Resend | null = null;

/**
 * Initializes and returns the Resend client.
 * Uses SecretsService to retrieve the API key securely.
 */
export async function getResendClient(): Promise<Resend | null> {
  if (resend) return resend;

  try {
    const resendApiKey = await SecretsService.getResendApiKey();

    if (!resendApiKey) {
      logger.error("RESEND_API_KEY is not configured - email sending will not work");
      return null;
    }

    resend = new Resend(resendApiKey);
    logger.info("Resend client initialized successfully");
    return resend;
  } catch (error) {
    logger.error("Error initializing Resend client:", error);
    return null;
  }
}
