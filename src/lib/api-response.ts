/**
 * Standardized API Response Utility
 * Provides consistent response format across all API endpoints
 */

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Creates a successful API response
 */
export function createSuccessResponse<T = any>(
  data?: T,
  message?: string,
  metadata?: Record<string, any>
): ApiResponse<T> {
  const response: ApiResponse<T> = {
    success: true,
  };

  if (data !== undefined) {
    response.data = data;
  }

  if (message) {
    response.message = message;
  }

  if (metadata) {
    response.metadata = metadata;
  }

  return response;
}

/**
 * Creates an error API response
 */
export function createErrorResponse(
  error: string,
  message?: string,
  metadata?: Record<string, any>
): ApiResponse {
  const response: ApiResponse = {
    success: false,
  };

  if (error) {
    response.error = error;
  }

  if (message) {
    response.message = message;
  }

  if (metadata) {
    response.metadata = metadata;
  }

  return response;
}

/**
 * Creates a validation error response
 */
export function createValidationErrorResponse(
  error: string,
  fieldErrors?: Record<string, string[]>
): ApiResponse {
  return {
    success: false,
    error,
    message: "Validation failed",
    metadata: fieldErrors ? { fieldErrors } : undefined,
  };
}

/**
 * Helper function to send standardized JSON responses
 */
export function sendJsonResponse<T = any>(
  res: any, // Express Response object
  statusCode: number,
  data?: T,
  message?: string,
  metadata?: Record<string, any>
): void {
  res.status(statusCode).json(createSuccessResponse(data, message, metadata));
}

/**
 * Helper function to send standardized error responses
 */
export function sendErrorResponse(
  res: any, // Express Response object
  statusCode: number,
  error: string,
  message?: string,
  metadata?: Record<string, any>
): void {
  res.status(statusCode).json(createErrorResponse(error, message, metadata));
}

/**
 * Helper function to send validation error responses
 */
export function sendValidationErrorResponse(
  res: any, // Express Response object
  statusCode: number = 400,
  error: string,
  fieldErrors?: Record<string, string[]>
): void {
  res
    .status(statusCode)
    .json(createValidationErrorResponse(error, fieldErrors));
}
