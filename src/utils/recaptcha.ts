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
    const secretKey = process.env.RC_SECRET;
    
    if (!secretKey) {
      console.warn("[reCAPTCHA] RC_SECRET not set. Bypassing verification.");
      return { success: true, message: "Bypassed (no key)" };
    }

    const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${token}`;
    const response = await fetch(verifyUrl, { method: "POST" });
    const data = (await response.json()) as RecaptchaResponse;

    console.log("[reCAPTCHA] Verify result:", {
      success: data.success,
      score: data.score,
      action: data.action,
    });

    if (!data.success || (data.score !== undefined && data.score < minScore)) {
      return {
        success: false,
        score: data.score,
        message: "Automated activity detected. Please try again.",
      };
    }

    return { success: true, score: data.score };
  } catch (error) {
    console.error("[reCAPTCHA] Verification error:", error);
    // Fail open by default to avoid blocking all users on network error
    return { success: true, message: "Bypassed (error)" };
  }
}
