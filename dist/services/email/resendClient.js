"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getResendClient = getResendClient;
const resend_1 = require("resend");
const secrets_service_1 = require("../secrets-service");
const logger_1 = __importDefault(require("../../monitoring/logger"));
let resend = null;
/**
 * Initializes and returns the Resend client.
 * Uses SecretsService to retrieve the API key securely.
 */
async function getResendClient() {
    if (resend)
        return resend;
    try {
        const resendApiKey = await secrets_service_1.SecretsService.getResendApiKey();
        if (!resendApiKey) {
            logger_1.default.error("RESEND_API_KEY is not configured - email sending will not work");
            return null;
        }
        resend = new resend_1.Resend(resendApiKey);
        logger_1.default.info("Resend client initialized successfully");
        return resend;
    }
    catch (error) {
        logger_1.default.error("Error initializing Resend client:", error);
        return null;
    }
}
