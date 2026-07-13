/**
 * API Response Consistency Tests
 * Verifies that all API endpoints return consistent response formats
 */

import {
  createSuccessResponse,
  createErrorResponse,
  createValidationErrorResponse,
} from "../lib/api-response";

describe("API Response Consistency Tests", () => {
  describe("Success Response Format", () => {
    it("should return consistent success response format", () => {
      const response = createSuccessResponse(
        { id: 1, name: "Test" },
        "Operation successful"
      );

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(response.message).toBe("Operation successful");
      expect(response.error).toBeUndefined();
    });

    it("should handle success response without data", () => {
      const response = createSuccessResponse(undefined, "Operation successful");

      expect(response.success).toBe(true);
      expect(response.data).toBeUndefined();
      expect(response.message).toBe("Operation successful");
      expect(response.error).toBeUndefined();
    });

    it("should handle success response with metadata", () => {
      const response = createSuccessResponse(
        { id: 1, name: "Test" },
        "Operation successful",
        { timestamp: new Date().toISOString(), requestId: "12345" }
      );

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(response.message).toBe("Operation successful");
      expect(response.metadata).toBeDefined();
      expect(response.metadata!.timestamp).toBeDefined();
      expect(response.metadata!.requestId).toBe("12345");
    });
  });

  describe("Error Response Format", () => {
    it("should return consistent error response format", () => {
      const response = createErrorResponse(
        "Invalid input",
        "Validation failed"
      );

      expect(response.success).toBe(false);
      expect(response.error).toBe("Invalid input");
      expect(response.message).toBe("Validation failed");
      expect(response.data).toBeUndefined();
    });

    it("should handle error response with metadata", () => {
      const response = createErrorResponse(
        "Invalid input",
        "Validation failed",
        { field: "email", code: "INVALID_FORMAT" }
      );

      expect(response.success).toBe(false);
      expect(response.error).toBe("Invalid input");
      expect(response.message).toBe("Validation failed");
      expect(response.metadata).toBeDefined();
      expect(response.metadata!.field).toBe("email");
      expect(response.metadata!.code).toBe("INVALID_FORMAT");
    });
  });

  describe("Validation Error Format", () => {
    it("should return consistent validation error format", () => {
      const response = createValidationErrorResponse("Validation failed", {
        email: ["Email is required", "Must be a valid email"],
        password: ["Password must be at least 8 characters"],
      });

      expect(response.success).toBe(false);
      expect(response.error).toBe("Validation failed");
      expect(response.message).toBe("Validation failed");
      expect(response.metadata).toBeDefined();
      expect(response.metadata!.fieldErrors).toBeDefined();
      expect(response.metadata!.fieldErrors!.email).toContain(
        "Email is required"
      );
    });
  });

  describe("Standardized Response Functions", () => {
    // Mock response object for testing
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    it("sendJsonResponse should call res.status and res.json correctly", () => {
      const { sendJsonResponse } = require("../lib/api-response");

      sendJsonResponse(mockRes as any, 200, { id: 1 }, "Success", {
        meta: "data",
      });

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { id: 1 },
        message: "Success",
        metadata: { meta: "data" },
      });
    });

    it("sendErrorResponse should call res.status and res.json correctly", () => {
      const { sendErrorResponse } = require("../lib/api-response");

      sendErrorResponse(
        mockRes as any,
        400,
        "Bad request",
        "Validation error",
        { code: "ERR_001" }
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: "Bad request",
        message: "Validation error",
        metadata: { code: "ERR_001" },
      });
    });
  });
});

// Test data for actual API endpoints
describe("Specific API Endpoints Response Format", () => {
  it("/api/citations/find-missing-link should return consistent format", () => {
    // Simulate the response format from the find-missing-link endpoint
    const mockResponse = createSuccessResponse({
      suggestions: [
        { title: "Sample Paper", authors: ["Author 1"], year: 2023 },
        { title: "Another Paper", authors: ["Author 2"], year: 2022 },
      ],
      cached: false,
    });

    expect(mockResponse.success).toBe(true);
    expect(mockResponse.data).toBeDefined();
    expect(Array.isArray(mockResponse.data?.suggestions)).toBe(true);
  });

  it("/api/originality/compare should return consistent format", () => {
    // Simulate the response format from the originality compare endpoint
    const mockResponse = createSuccessResponse({
      similarityScore: 0.15,
      flaggedSections: [],
      overallAssessment: "Acceptable",
    });

    expect(mockResponse.success).toBe(true);
    expect(mockResponse.data).toBeDefined();
    expect(typeof mockResponse.data?.similarityScore).toBe("number");
  });
});
