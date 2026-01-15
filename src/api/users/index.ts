import { Router } from "express";
import {
  GET,
  PUT,
  DELETE,
  updateProfileWithOTP,
  changePassword,
  enable2FA,
  getAccountUsage,
  updateAccountPreferences,
  hasFeatureAccess,
} from "./route";
import { POST as EXPORT_POST } from "./export/route";
import { POST_REQUEST_OTP as REQUEST_OTP_POST } from "./route";
import { uploadAvatar } from "./avatar-express";
import multer from "multer";

const router: Router = Router();

// Get user account details
router.get("/", async (req, res) => {
  try {
    // Create a mock request object that matches the Edge function signature
    const mockRequest = {
      headers: {
        get: (name: string) => req.headers[name.toLowerCase()],
      },
    };

    const response = await GET(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Update user profile or password
router.put("/", async (req, res) => {
  try {
    // Create a mock request object that matches the Edge function signature
    const mockRequest = {
      json: async () => req.body,
      headers: {
        get: (name: string) => req.headers[name.toLowerCase()],
      },
    };

    const response = await PUT(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Update user profile with OTP verification
router.put("/profile", async (req, res) => {
  try {
    // Create a mock request object that matches the Edge function signature
    const mockRequest = {
      json: async () => req.body,
      headers: {
        get: (name: string) => req.headers[name.toLowerCase()],
      },
    };

    const response = await updateProfileWithOTP(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Change user password
router.post("/change-password", async (req, res) => {
  try {
    // Create a mock request object that matches the Edge function signature
    const mockRequest = {
      json: async () => req.body,
      headers: {
        get: (name: string) => req.headers[name.toLowerCase()],
      },
    };

    const response = await changePassword(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Enable 2FA
router.post("/enable-2fa", async (req, res) => {
  try {
    // Create a mock request object that matches the Edge function signature
    const mockRequest = {
      json: async () => req.body,
      headers: {
        get: (name: string) => req.headers[name.toLowerCase()],
      },
    };

    const response = await enable2FA(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Request OTP for profile update
router.post("/request-otp", async (req, res) => {
  try {
    // Create a mock request object that matches the Edge function signature
    const mockRequest = {
      json: async () => req.body,
      headers: {
        get: (name: string) => req.headers[name.toLowerCase()],
      },
    };

    const response = await REQUEST_OTP_POST(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Export user data
router.post("/export-data", async (req, res) => {
  try {
    // Create a mock request object that matches the Edge function signature
    const mockRequest = {
      json: async () => req.body,
      headers: {
        get: (name: string) => req.headers[name.toLowerCase()],
      },
    };

    const response = await EXPORT_POST(mockRequest as any);

    // Check content type to determine how to handle the response
    const contentType = response.headers.get("Content-Type");

    if (contentType && contentType.includes("application/json")) {
      const data = await response.json();
      return res.status(response.status).json(data);
    } else {
      // Handle binary data (like ZIP files)
      const buffer = await response.arrayBuffer();
      
      // Forward headers
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      
      return res.status(response.status).send(Buffer.from(buffer));
    }
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Delete user account
router.delete("/", async (req, res) => {
  try {
    // Get user from authentication middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Get authorization header from original request
    const authHeader = req.headers.authorization;

    // Create a mock request object that matches the Edge function signature and includes user info
    const mockRequest = {
      json: async () => req.body,
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === "authorization") {
            return authHeader;
          }
          return req.headers[name.toLowerCase()];
        },
        authorization: authHeader,
      },
      user: { id: userId },
    };

    const response = await DELETE(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Upload user avatar
const upload = multer();
router.post("/avatar", upload.single("file"), uploadAvatar);

// Get account usage statistics
router.get("/usage", async (req, res) => {
  try {
    // Create a mock request object that matches the Edge function signature
    const mockRequest = {
      headers: {
        get: (name: string) => req.headers[name.toLowerCase()],
      },
    };

    const response = await getAccountUsage(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Update account preferences
router.put("/preferences", async (req, res) => {
  try {
    // Create a mock request object that matches the Edge function signature
    const mockRequest = {
      json: async () => req.body,
      headers: {
        get: (name: string) => req.headers[name.toLowerCase()],
      },
    };

    const response = await updateAccountPreferences(mockRequest as any);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Check feature access
router.get("/features/:feature", async (req, res) => {
  try {
    // Create a mock request object that matches the Edge function signature
    const mockRequest = {
      headers: {
        get: (name: string) => req.headers[name.toLowerCase()],
      },
    };

    const response = await hasFeatureAccess(
      mockRequest as any,
      req.params.feature
    );
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
