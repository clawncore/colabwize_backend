import express from "express";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";
import hybridRouter from "./hybrid";
import twoFactorRouter from "./2fa";
import { prisma } from "../../lib/prisma"; // For validation

const router = express.Router();

// Mount hybrid auth routes
router.use("/hybrid", hybridRouter);
router.use("/2fa", twoFactorRouter);

// Removed legacy routes (register, verify-otp, resend-otp, login)
// as we have migrated to Supabase Hybrid Auth.


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
    return res.status(200).json({
      success: false,
      message: "Service temporarily unavailable.",
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
      .status(200)
      .json({ success: false, message: "Validation service unavailable" });
  }
});

export default router;
