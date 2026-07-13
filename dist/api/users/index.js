"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const route_1 = require("./route");
const route_2 = require("./export/route");
const route_3 = require("./route");
const avatar_express_1 = require("./avatar-express");
const multer_1 = __importDefault(require("multer"));
const router = (0, express_1.Router)();
// Get user account details
router.get("/", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            headers: {
                get: (name) => req.headers[name.toLowerCase()],
            },
        };
        const response = await (0, route_1.GET)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
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
                get: (name) => req.headers[name.toLowerCase()],
            },
        };
        const response = await (0, route_1.PUT)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
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
                get: (name) => req.headers[name.toLowerCase()],
            },
        };
        const response = await (0, route_1.updateProfileWithOTP)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
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
                get: (name) => req.headers[name.toLowerCase()],
            },
        };
        const response = await (0, route_1.changePassword)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
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
                get: (name) => req.headers[name.toLowerCase()],
            },
        };
        const response = await (0, route_3.POST_REQUEST_OTP)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
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
                get: (name) => req.headers[name.toLowerCase()],
            },
        };
        const response = await (0, route_2.POST)(mockRequest);
        // Check content type to determine how to handle the response
        const contentType = response.headers.get("Content-Type");
        if (contentType && contentType.includes("application/json")) {
            const data = await response.json();
            return res.status(response.status).json(data);
        }
        else {
            // Handle binary data (like ZIP files)
            const buffer = await response.arrayBuffer();
            // Forward headers
            response.headers.forEach((value, key) => {
                res.setHeader(key, value);
            });
            return res.status(response.status).send(Buffer.from(buffer));
        }
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Delete user account
router.delete("/", async (req, res) => {
    try {
        // Get user from authentication middleware
        const userId = req.user?.id;
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
                get: (name) => {
                    if (name.toLowerCase() === "authorization") {
                        return authHeader;
                    }
                    return req.headers[name.toLowerCase()];
                },
                authorization: authHeader,
            },
            user: { id: userId },
        };
        const response = await (0, route_1.DELETE)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Upload user avatar
const upload = (0, multer_1.default)();
router.post("/avatar", upload.single("file"), avatar_express_1.uploadAvatar);
// Get account usage statistics
router.get("/usage", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            headers: {
                get: (name) => req.headers[name.toLowerCase()],
            },
        };
        const response = await (0, route_1.getAccountUsage)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
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
                get: (name) => req.headers[name.toLowerCase()],
            },
        };
        const response = await (0, route_1.updateAccountPreferences)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Check feature access
router.get("/features/:feature", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            headers: {
                get: (name) => req.headers[name.toLowerCase()],
            },
        };
        const response = await (0, route_1.hasFeatureAccess)(mockRequest, req.params.feature);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Get user's referral data
router.get("/referrals", async (req, res) => {
    try {
        // Create a mock request object that matches the Edge function signature
        const mockRequest = {
            headers: {
                get: (name) => req.headers[name.toLowerCase()],
            },
        };
        const response = await (0, route_1.getReferralData)(mockRequest);
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});
exports.default = router;
