/**
 * Centralized safe error response utilities.
 *
 * Prevents raw technical error messages (Supabase, PostgreSQL, provider
 * errors, stack traces) from ever reaching the client. All error responses
 * go through here so the security boundary is in one auditable place.
 */

import logger from "../monitoring/logger";

/**
 * Stable application error codes used across the codebase.
 * These map to safe user-facing messages.
 */
export const ERROR_CODES = {
  // Auth
  ACCOUNT_EXISTS: "ACCOUNT_EXISTS",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  EMAIL_NOT_CONFIRMED: "EMAIL_NOT_CONFIRMED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  RATE_LIMITED: "RATE_LIMITED",

  // Password reset
  INVALID_TOKEN: "INVALID_TOKEN",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_USED: "TOKEN_USED",

  // Validation
  VALIDATION_ERROR: "VALIDATION_ERROR",

  // Resources
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  DUPLICATE_RESOURCE: "DUPLICATE_RESOURCE",

  // Operations
  OPERATION_FAILED: "OPERATION_FAILED",
  SIGNUP_FAILED: "SIGNUP_FAILED",
  EMAIL_SEND_FAILED: "EMAIL_SEND_FAILED",

  // File / upload
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  UNSUPPORTED_FILE: "UNSUPPORTED_FILE",
  FILE_UPLOAD_FAILED: "FILE_UPLOAD_FAILED",

  // Payments
  PAYMENT_FAILED: "PAYMENT_FAILED",
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED",

  // AI
  AI_SERVICE_ERROR: "AI_SERVICE_ERROR",

  // General
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type AppErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * User-safe messages for each error code.
 * Never contains raw technical details.
 */
const SAFE_MESSAGES: Record<string, string> = {
  // Auth
  [ERROR_CODES.ACCOUNT_EXISTS]:
    "An account with this email already exists. Please sign in instead.",
  [ERROR_CODES.INVALID_CREDENTIALS]:
    "The email or password is incorrect. Please check your details and try again.",
  [ERROR_CODES.EMAIL_NOT_VERIFIED]:
    "Please verify your email address before continuing.",
  [ERROR_CODES.EMAIL_NOT_CONFIRMED]:
    "Please confirm your email address before logging in.",
  [ERROR_CODES.SESSION_EXPIRED]:
    "Your session has expired. Please sign in again.",
  [ERROR_CODES.UNAUTHORIZED]:
    "Authentication is required. Please sign in.",
  [ERROR_CODES.FORBIDDEN]:
    "You do not have permission to perform this action.",
  [ERROR_CODES.RATE_LIMITED]:
    "Too many attempts. Please try again in a few minutes.",

  // Password reset
  [ERROR_CODES.INVALID_TOKEN]:
    "This reset link is invalid or has expired. Please request a new one.",
  [ERROR_CODES.TOKEN_EXPIRED]:
    "This reset link has expired. Please request a new one.",
  [ERROR_CODES.TOKEN_USED]:
    "This reset link has already been used. Please request a new one if needed.",

  // Validation
  [ERROR_CODES.VALIDATION_ERROR]:
    "Please check your input and try again.",

  // Resources
  [ERROR_CODES.NOT_FOUND]:
    "The requested resource could not be found.",
  [ERROR_CODES.CONFLICT]:
    "A conflict occurred. Please try again.",
  [ERROR_CODES.DUPLICATE_RESOURCE]:
    "This resource already exists.",

  // Operations
  [ERROR_CODES.OPERATION_FAILED]:
    "The operation could not be completed. Please try again.",
  [ERROR_CODES.SIGNUP_FAILED]:
    "Failed to create account. Please try again or contact support.",
  [ERROR_CODES.EMAIL_SEND_FAILED]:
    "We couldn't send the email right now. Please try again.",

  // File / upload
  [ERROR_CODES.FILE_TOO_LARGE]:
    "This file is too large. Please choose a smaller file.",
  [ERROR_CODES.UNSUPPORTED_FILE]:
    "This file type is not supported.",
  [ERROR_CODES.FILE_UPLOAD_FAILED]:
    "Upload failed. Please try again.",

  // Payments
  [ERROR_CODES.PAYMENT_FAILED]:
    "Payment failed. Please check your payment details and try again.",
  [ERROR_CODES.PAYMENT_REQUIRED]:
    "A paid plan is required for this feature.",

  // AI
  [ERROR_CODES.AI_SERVICE_ERROR]:
    "AI service is temporarily unavailable. Please try again later.",

  // General
  [ERROR_CODES.INTERNAL_ERROR]:
    "Something went wrong. Please try again later.",
  [ERROR_CODES.NETWORK_ERROR]:
    "Unable to connect. Please check your internet connection and try again.",
  [ERROR_CODES.TIMEOUT]:
    "The request timed out. Please try again.",
  [ERROR_CODES.SERVICE_UNAVAILABLE]:
    "Service is temporarily unavailable. Please try again.",
};

/** Map Supabase / Postgres error patterns to safe application codes. */
const SUPABASE_CODE_MAP: Record<string, AppErrorCode> = {
  "already.*exist|duplicate.*key|user_with_email_already_exists":
    ERROR_CODES.ACCOUNT_EXISTS,
  "invalid.*credentials|invalid.*login|wrong.*password":
    ERROR_CODES.INVALID_CREDENTIALS,
  "email.*not.*confirmed|email.*not.*verified|not_confirmed":
    ERROR_CODES.EMAIL_NOT_CONFIRMED,
  "jwt|expired|invalid.*token":
    ERROR_CODES.SESSION_EXPIRED,
  "rate.*limit|too.*many.*request":
    ERROR_CODES.RATE_LIMITED,
};

/**
 * Detect error code from a raw error message (Supabase, Postgres, etc).
 * Returns a stable application error code.
 */
export function detectErrorCode(
  rawMessage: string,
  errorCode?: string,
): AppErrorCode {
  // Check raw message patterns from the map
  for (const [pattern, code] of Object.entries(SUPABASE_CODE_MAP)) {
    const regex = new RegExp(pattern, "i");
    if (regex.test(rawMessage)) {
      return code;
    }
  }

  // Check for common patterns
  const lower = rawMessage.toLowerCase();
  if (lower.includes("already") || lower.includes("duplicate") || lower.includes("exists")) {
    return ERROR_CODES.ACCOUNT_EXISTS;
  }
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return ERROR_CODES.INVALID_CREDENTIALS;
  }
  if (lower.includes("email not") && lower.includes("confirmed")) {
    return ERROR_CODES.EMAIL_NOT_CONFIRMED;
  }

  return ERROR_CODES.INTERNAL_ERROR;
}

/**
 * Get a safe user-facing message from a raw error.
 * Falls back to a generic message if no pattern matches.
 */
export function getSafeMessage(
  rawMessage: string,
  fallback: string = SAFE_MESSAGES[ERROR_CODES.INTERNAL_ERROR],
): string {
  const code = detectErrorCode(rawMessage);
  return SAFE_MESSAGES[code] || fallback;
}

/**
 * Get the safe message for an error code.
 */
export function getSafeMessageForCode(code: string): string {
  return SAFE_MESSAGES[code] || SAFE_MESSAGES[ERROR_CODES.INTERNAL_ERROR];
}

/**
 * Log an error with safe context (no sensitive data).
 */
export function logError(
  message: string,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  const err = error instanceof Error ? error.message : String(error);
  logger.error(message, {
    error: err,
    ...context,
  });
}
