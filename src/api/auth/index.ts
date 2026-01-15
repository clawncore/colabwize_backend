import express from "express";
import { AuthServiceWithOTP } from "../../services/authServiceWithOTP";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";
import hybridRouter from "./hybrid";
import { prisma } from "../../lib/prisma"; // For validation

const router = express.Router();

// Mount hybrid auth routes
router.use("/hybrid", hybridRouter);

/**
 * POST /api/auth/register
 * Register a new user and send OTP
 */
router.post("/register", async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    // Password validation (min 6 characters)
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const result = await AuthServiceWithOTP.register({
      email,
      password,
      fullName,
    });

    if (result.success) {
      return res.status(201).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({
      success: false,
      message: "Registration failed. Please try again.",
    });
  }
});

/**
 * POST /api/auth/verify-otp
 * Verify OTP code
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otpCode } = req.body;

    if (!email || !otpCode) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP code are required",
      });
    }

    const result = await AuthServiceWithOTP.verifyOTP(email, otpCode);

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    console.error("Verify OTP error:", error);
    return res.status(500).json({
      success: false,
      message: "OTP verification failed. Please try again.",
    });
  }
});

/**
 * POST /api/auth/resend-otp
 * Resend OTP code
 */
router.post("/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const result = await AuthServiceWithOTP.resendOTP(email);

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    console.error("Resend OTP error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to resend OTP. Please try again.",
    });
  }
});

/**
 * POST /api/auth/login
 * Login user
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const result = await AuthServiceWithOTP.login(email, password);

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Login failed. Please try again.",
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user (requires authentication)
 */
router.get("/me", authenticateHybridRequest, async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.email.split("@")[0],
        fullName: user.full_name,
        emailVerified: user.email_verified,
        surveyCompleted: user.survey_completed,
      },
    });
  } catch (error) {
    console.error("Get user error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get user data.",
    });
  }
});

/**
 * POST /api/auth/validate
 * Validate user details (email, phone, etc.) during signup
 */
router.post("/validate", async (req, res) => {
  try {
    const { email, phoneNumber, fullName } = req.body;
    const results: any = {};

    if (email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      results.emailExists = !!existing;
      if (existing) results.message = "Email already registered";
    }

    if (phoneNumber) {
      // Find valid user by phone number
      const existing = await prisma.user.findFirst({
        where: { phone_number: phoneNumber },
      });
      results.phoneNumberExists = !!existing;
      if (existing) results.message = "Phone number already registered";
    }

    // Optional: add logic for full name or other fields if needed
    if (fullName) {
      results.fullNameExists = false;
    }

    return res.status(200).json({
      success: true,
      validationResults: results,
    });
  } catch (error) {
    console.error("Validation error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Validation failed" });
  }
});

export default router;
