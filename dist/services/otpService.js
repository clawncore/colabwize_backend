"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OTPService = void 0;
const emailService_1 = require("./emailService");
const logger_1 = __importDefault(require("../monitoring/logger"));
const prisma_1 = require("../lib/prisma");
/**
 * OTP Service for handling one-time password generation, storage, and verification
 */
class OTPService {
    // In-memory cache for OTPs to prevent duplicate sends (in production, use Redis)
    static otpCache = new Map();
    // Generate a random 6-digit OTP
    static generateOTP() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }
    // Check if an OTP is expired
    static isExpired(expiresAt) {
        return new Date() > expiresAt;
    }
    /**
     * Send OTP to user via email or SMS
     * @param userId - User ID
     * @param email - User's email address
     * @param phoneNumber - User's phone number
     * @param method - Method to send OTP ("email" or "sms")
     * @param fullName - User's full name
     * @param isProfileUpdate - Whether this is for profile update verification
     * @param isEmailChange - Whether this is for email change verification
     * @returns boolean indicating success
     */
    static async sendOTP(userId, email, phoneNumber, method, fullName = "", isProfileUpdate = false, isEmailChange = false) {
        try {
            // Check cache to prevent duplicate sends
            const cacheKey = `${userId}-${method}`;
            const cachedOTP = this.otpCache.get(cacheKey);
            let otp;
            let expiresAt;
            if (cachedOTP && !this.isExpired(cachedOTP.expiresAt)) {
                logger_1.default.info("OTP already sent recently, using cached OTP", {
                    userId,
                    method,
                });
                // Use the existing OTP instead of generating a new one
                otp = cachedOTP.otp;
                expiresAt = cachedOTP.expiresAt;
                // Also update database with cached OTP to ensure consistency
                try {
                    await prisma_1.prisma.oTPVerification.upsert({
                        where: {
                            user_id_method: {
                                user_id: userId,
                                method: method,
                            },
                        },
                        update: {
                            otp_code: otp,
                            expires_at: expiresAt,
                        },
                        create: {
                            user_id: userId,
                            method: method,
                            otp_code: otp,
                            expires_at: expiresAt,
                            phone_number: method === "sms" ? phoneNumber : null,
                        },
                    });
                }
                catch (dbError) {
                    logger_1.default.error("Error storing OTP in database", {
                        error: dbError instanceof Error ? dbError.message : String(dbError),
                        userId,
                        method,
                    });
                    // Don't fail if database storage fails, but log the error
                }
            }
            else {
                // Generate new OTP
                otp = this.generateOTP();
                expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
                // Store in cache
                this.otpCache.set(cacheKey, { otp, expiresAt, method });
                // Also store in database for persistence
                try {
                    await prisma_1.prisma.oTPVerification.upsert({
                        where: {
                            user_id_method: {
                                user_id: userId,
                                method: method,
                            },
                        },
                        update: {
                            otp_code: otp,
                            expires_at: expiresAt,
                        },
                        create: {
                            user_id: userId,
                            method: method,
                            otp_code: otp,
                            expires_at: expiresAt,
                            phone_number: method === "sms" ? phoneNumber : null,
                        },
                    });
                }
                catch (dbError) {
                    logger_1.default.error("Error storing OTP in database", {
                        error: dbError instanceof Error ? dbError.message : String(dbError),
                        userId,
                        method,
                    });
                    // Don't fail if database storage fails, but log the error
                }
                // Send OTP based on method
                if (method === "email") {
                    const emailToSend = isEmailChange && isProfileUpdate ? email : email || "";
                    if (!emailToSend) {
                        logger_1.default.error("Email address is required for email OTP", { userId });
                        return false;
                    }
                    const success = await emailService_1.EmailService.sendOTPEmail(emailToSend, otp, fullName);
                    if (!success) {
                        logger_1.default.error("Failed to send OTP email", {
                            userId,
                            email: emailToSend,
                        });
                        return false;
                    }
                    logger_1.default.info("OTP email sent successfully", {
                        userId,
                        email: emailToSend,
                    });
                }
                else {
                    logger_1.default.error("Invalid or unsupported OTP method", { method, userId });
                    return false;
                }
            }
            return true;
        }
        catch (error) {
            logger_1.default.error("Error in sendOTP", {
                error: error instanceof Error ? error.message : String(error),
                userId,
                method,
                email,
                phoneNumber,
            });
            return false;
        }
    }
    /**
     * Verify OTP for user
     * @param userId - User ID
     * @param otp - OTP to verify
     * @returns boolean indicating if OTP is valid
     */
    static async verifyOTP(userId, otp) {
        try {
            if (!userId || !otp) {
                logger_1.default.warn("Missing userId or otp for verification", { userId });
                return false;
            }
            // First check cache - construct cache keys for both possible methods
            const emailCacheKey = `${userId}-email`;
            const smsCacheKey = `${userId}-sms`;
            // Check email cache
            const emailCachedData = this.otpCache.get(emailCacheKey);
            if (emailCachedData &&
                emailCachedData.otp === otp &&
                !this.isExpired(emailCachedData.expiresAt)) {
                // Remove the used OTP from cache
                this.otpCache.delete(emailCacheKey);
                // Also remove from database
                try {
                    // Also remove all OTPs for this user from database to clean up
                    await prisma_1.prisma.oTPVerification.deleteMany({
                        where: {
                            user_id: userId,
                        },
                    });
                }
                catch (dbError) {
                    logger_1.default.error("Error deleting OTP from database", {
                        error: dbError instanceof Error ? dbError.message : String(dbError),
                        userId,
                    });
                }
                logger_1.default.info("OTP verified successfully (from email cache)", { userId });
                return true;
            }
            // Check SMS cache
            const smsCachedData = this.otpCache.get(smsCacheKey);
            if (smsCachedData &&
                smsCachedData.otp === otp &&
                !this.isExpired(smsCachedData.expiresAt)) {
                // Remove the used OTP from cache
                this.otpCache.delete(smsCacheKey);
                // Also remove from database
                try {
                    // Also remove all OTPs for this user from database to clean up
                    await prisma_1.prisma.oTPVerification.deleteMany({
                        where: {
                            user_id: userId,
                        },
                    });
                }
                catch (dbError) {
                    logger_1.default.error("Error deleting OTP from database", {
                        error: dbError instanceof Error ? dbError.message : String(dbError),
                        userId,
                    });
                }
                logger_1.default.info("OTP verified successfully (from SMS cache)", { userId });
                return true;
            }
            // If not found in cache, check database
            const dbOTP = await prisma_1.prisma.oTPVerification.findFirst({
                where: {
                    user_id: userId,
                    otp_code: otp,
                },
            });
            if (!dbOTP) {
                logger_1.default.warn("OTP not found in database", { userId });
                return false;
            }
            if (this.isExpired(dbOTP.expires_at)) {
                logger_1.default.warn("OTP has expired", { userId });
                // Clean up expired OTP
                try {
                    await prisma_1.prisma.oTPVerification.delete({
                        where: { id: dbOTP.id },
                    });
                }
                catch (dbError) {
                    logger_1.default.error("Error deleting expired OTP from database", {
                        error: dbError instanceof Error ? dbError.message : String(dbError),
                        userId,
                    });
                }
                return false;
            }
            // Remove all OTPs for this user from database
            try {
                await prisma_1.prisma.oTPVerification.deleteMany({
                    where: { user_id: userId },
                });
            }
            catch (dbError) {
                logger_1.default.error("Error deleting OTP from database", {
                    error: dbError instanceof Error ? dbError.message : String(dbError),
                    userId,
                });
            }
            logger_1.default.info("OTP verified successfully (from database)", { userId });
            return true;
        }
        catch (error) {
            logger_1.default.error("Error in verifyOTP", {
                error: error instanceof Error ? error.message : String(error),
                userId,
            });
            return false;
        }
    }
    /**
     * Clear all cached OTPs for a user (useful for cleanup)
     * @param userId - User ID
     */
    static clearUserOTPs(userId) {
        for (const cacheKey of this.otpCache.keys()) {
            if (cacheKey.startsWith(userId)) {
                this.otpCache.delete(cacheKey);
            }
        }
    }
}
exports.OTPService = OTPService;
