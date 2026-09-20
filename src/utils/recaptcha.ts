import fetch from "node-fetch";

export interface RecaptchaResponse {
  success: boolean;
  score?: number;
  action?: string;
  "error-codes"?: string[];
  message?: string;
}

/**
 * Verifies a reCAPTCHA v3 token with Google
 * @param token The token from the frontend
 * @param minScore Minimum acceptable score (default 0.5)
 * @returns Object with success status and score
 */
export async function verifyRecaptcha(
  token: string,
  minScore: number = 0.5
): Promise<RecaptchaResponse> {
  try {
    // Fail-closed in production even without keys or on network errors
    const v3Secret = process.env.RC_SECRET;
    const v2Secret = process.env.RC_V2_SECRET;

    if (!v3Secret && !v2Secret) {
      console.error("[reCAPTCHA] No secret keys configured. Fail-closed mode.");
      return { success: false, message: "Security verification unavailable - please try again later" };
    }

    // Try verifying with the primary v3 secret first
    let verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${v3Secret || v2Secret}&response=${token}`;
    let response = await fetch(verifyUrl, { method: "POST" });

    if (!response.ok) {
      console.error("[reCAPTCHA] Verification request failed:", response.status);
      // Fail-closed on network errors
      return { success: false, message: "Security verification service unavailable" };
    }

    let data = (await response.json()) as RecaptchaResponse;

    // If it failed and we have a second key, try that too (one might be v2, one v3)
    if (!data.success && v3Secret && v2Secret) {
      console.log("[reCAPTCHA] Primary key failed, trying secondary key...");
      verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${v2Secret}&response=${token}`;
      response = await fetch(verifyUrl, { method: "POST" });

      if (!response.ok) {
        console.error("[reCAPTCHA] Secondary verification request failed:", response.status);
        return { success: false, message: "Security verification service unavailable" };
      }

      data = (await response.json()) as RecaptchaResponse;
    }

    console.log("[reCAPTCHA] Verify result:", {
      success: data.success,
      score: data.score,
      action: data.action,
      type: data.score !== undefined ? "v3" : "v2",
    });

    if (!data.success) {
      return {
        success: false,
        message: "Security verification could not be completed. Please use a standard, up-to-date browser to avoid security risks.",
        "error-codes": data["error-codes"] || [],
      };
    }

    // For v3, also check the score
    if (data.score !== undefined && data.score < minScore) {
      return {
        success: false,
        score: data.score,
        message: "Automated activity detected. Please complete the security challenge to proceed.",
      };
    }

    return { success: true, score: data.score };
  } catch (error) {
    console.error("[reCAPTCHA] Verification error:", error);
    // Fail-closed on any error to prevent bypass
    return { success: false, message: "Security verification service unavailable" };
  }
}
