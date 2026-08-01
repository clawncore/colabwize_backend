"use strict";
/**
 * Standardized API Response Utility
 * Provides consistent response format across all API endpoints
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSuccessResponse = createSuccessResponse;
exports.createErrorResponse = createErrorResponse;
exports.createValidationErrorResponse = createValidationErrorResponse;
exports.sendJsonResponse = sendJsonResponse;
exports.sendErrorResponse = sendErrorResponse;
exports.sendValidationErrorResponse = sendValidationErrorResponse;
/**
 * Creates a successful API response
 */
function createSuccessResponse(data, message, metadata) {
    const response = {
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
function createErrorResponse(error, message, metadata) {
    const response = {
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
function createValidationErrorResponse(error, fieldErrors) {
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
function sendJsonResponse(res, // Express Response object
statusCode, data, message, metadata) {
    res.status(statusCode).json(createSuccessResponse(data, message, metadata));
}
/**
 * Helper function to send standardized error responses
 */
function sendErrorResponse(res, // Express Response object
statusCode, error, message, metadata) {
    res.status(statusCode).json(createErrorResponse(error, message, metadata));
}
/**
 * Helper function to send validation error responses
 */
function sendValidationErrorResponse(res, // Express Response object
statusCode = 400, error, fieldErrors) {
    res
        .status(statusCode)
        .json(createValidationErrorResponse(error, fieldErrors));
}
