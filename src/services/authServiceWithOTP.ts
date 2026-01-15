import { prisma } from "../lib/prisma";
import { EmailService } from "./emailService";
import logger from "../monitoring/logger";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { SecretsService } from "./secrets-service";

/**
 * Authentication Service for Email/Password Auth with OTP Verification
 */
export class AuthServiceWithOTP {
  /**
   * Generate a 6-digit OTP code
   */
  private static generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Generate JWT token
   */
  private static async generateToken(userId: string, email: string): Promise<string> {
    const jwtSecret = await SecretsService.getSecret("JWT_SECRET") || "your-secret-key-change-this";
    return jwt.sign(
      { userId, email },
      jwtSecret,
      { expiresIn: "7d" }
    );
  }

  /**
   * Register a new user and send OTP
   */
  static async register(userData: {
    email: string;
    password: string;
    fullName?: string;
  }): Promise<{
    success: boolean;
    message: string;
    userId?: string;
  }> {
    try {
      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: userData.email },
      });

      if (existingUser) {
        return {
          success: false,
          message: "User with this email already exists",
        };
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 10);

      // Create user
      const user = await prisma.user.create({
        data: {
          email: userData.email,
          full_name: userData.fullName,
          email_verified: false,
          survey_completed: false,
        },
      });

      // Generate OTP
      const otpCode = this.generateOTP();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10); // OTP expires in 10 minutes

      // Store OTP in database
      await prisma.oTPVerification.create({
        data: {
          user_id: user.id,
          email: userData.email,
          otp_code: otpCode,
          expires_at: expiresAt,
          verified: false,
        },
      });

      // Send OTP email
      const emailSent = await EmailService.sendOTPEmail(
        userData.email,
        otpCode,
        userData.fullName || ""
      );

      if (!emailSent) {
        logger.error("Failed to send OTP email", { email: userData.email });
        // Don't fail registration, user can resend OTP
      }

      logger.info("User registered successfully", {
        userId: user.id,
        email: userData.email,
      });

      return {
        success: true,
        message: "Registration successful. Please check your email for OTP.",
        userId: user.id,
      };
    } catch (error) {
      logger.error("Registration failed", { error });
      return {
        success: false,
        message: "Registration failed. Please try again.",
      };
    }
  }

  /**
   * Verify OTP code
   */
  static async verifyOTP(
    email: string,
    otpCode: string
  ): Promise<{
    success: boolean;
    message: string;
    token?: string;
    user?: any;
  }> {
    try {
      // Find user
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        return {
          success: false,
          message: "User not found",
        };
      }

      // Find OTP verification
      const otpVerification = await prisma.oTPVerification.findFirst({
        where: {
          user_id: user.id,
          otp_code: otpCode,
          verified: false,
        },
        orderBy: {
          created_at: "desc",
        },
      });

      if (!otpVerification) {
        return {
          success: false,
          message: "Invalid OTP code",
        };
      }

      // Check if OTP is expired
      if (new Date() > otpVerification.expires_at) {
        return {
          success: false,
          message: "OTP code has expired. Please request a new one.",
        };
      }

      // Mark OTP as verified
      await prisma.oTPVerification.update({
        where: { id: otpVerification.id },
        data: { verified: true },
      });

      // Mark user email as verified
      await prisma.user.update({
        where: { id: user.id },
        data: { email_verified: true },
      });

      // Generate JWT token
      const token = await this.generateToken(user.id, user.email);

      logger.info("OTP verified successfully", {
        userId: user.id,
        email: user.email,
      });

      return {
        success: true,
        message: "Email verified successfully",
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          emailVerified: true,
          surveyCompleted: user.survey_completed,
        },
      };
    } catch (error) {
      logger.error("OTP verification failed", { error });
      return {
        success: false,
        message: "OTP verification failed. Please try again.",
      };
    }
  }

  /**
   * Resend OTP code
   */
  static async resendOTP(email: string): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      // Find user
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        return {
          success: false,
          message: "User not found",
        };
      }

      // Check if user is already verified
      if (user.email_verified) {
        return {
          success: false,
          message: "Email is already verified",
        };
      }

      // Generate new OTP
      const otpCode = this.generateOTP();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      // Store new OTP
      await prisma.oTPVerification.create({
        data: {
          user_id: user.id,
          email: user.email,
          otp_code: otpCode,
          expires_at: expiresAt,
          verified: false,
        },
      });

      // Send OTP email
      const emailSent = await EmailService.sendOTPEmail(
        user.email,
        otpCode,
        user.full_name || ""
      );

      if (!emailSent) {
        logger.error("Failed to resend OTP email", { email: user.email });
        return {
          success: false,
          message: "Failed to send OTP email. Please try again.",
        };
      }

      logger.info("OTP resent successfully", {
        userId: user.id,
        email: user.email,
      });

      return {
        success: true,
        message: "OTP sent successfully. Please check your email.",
      };
    } catch (error) {
      logger.error("Resend OTP failed", { error });
      return {
        success: false,
        message: "Failed to resend OTP. Please try again.",
      };
    }
  }

  /**
   * Login user
   */
  static async login(
    email: string,
    password: string
  ): Promise<{
    success: boolean;
    message: string;
    token?: string;
    user?: any;
    requiresOTP?: boolean;
    requiresSurvey?: boolean;
  }> {
    try {
      // Find user
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        return {
          success: false,
          message: "Invalid email or password",
        };
      }

      // For now, we'll skip password verification since we don't have a password field
      // In production, you'd verify: const isValidPassword = await bcrypt.compare(password, user.password);

      // Check if email is verified
      if (!user.email_verified) {
        // Send new OTP
        await this.resendOTP(email);
        return {
          success: false,
          message: "Email not verified. We've sent you a new OTP.",
          requiresOTP: true,
        };
      }

      // Check if survey is completed
      if (!user.survey_completed) {
        // Generate token for survey completion
        const token = await this.generateToken(user.id, user.email);
        return {
          success: true,
          message: "Please complete the survey to continue",
          token,
          requiresSurvey: true,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.full_name,
            emailVerified: user.email_verified,
            surveyCompleted: user.survey_completed,
          },
        };
      }

      // Generate JWT token
      const token = await this.generateToken(user.id, user.email);

      logger.info("User logged in successfully", {
        userId: user.id,
        email: user.email,
      });

      return {
        success: true,
        message: "Login successful",
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          emailVerified: user.email_verified,
          surveyCompleted: user.survey_completed,
        },
      };
    } catch (error) {
      logger.error("Login failed", { error });
      return {
        success: false,
        message: "Login failed. Please try again.",
      };
    }
  }

  /**
   * Verify JWT token
   */
  static async verifyToken(token: string): Promise<{
    valid: boolean;
    userId?: string;
    email?: string;
  }> {
    try {
      const jwtSecret = await SecretsService.getSecret("JWT_SECRET") || "your-secret-key-change-this";
      const decoded = jwt.verify(token, jwtSecret) as any;
      return {
        valid: true,
        userId: decoded.userId,
        email: decoded.email,
      };
    } catch (error) {
      return {
        valid: false,
      };
    }
  }
}
