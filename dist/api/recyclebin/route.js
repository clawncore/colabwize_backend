"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const recycleBinService_1 = require("../../services/recycleBinService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const prisma_1 = require("../../lib/prisma");
const router = (0, express_1.Router)();
// Get all recycled items for a user
router.get("/", async (req, res) => {
    try {
        const itemType = req.query.type || undefined;
        // Use authenticated user ID
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
                debug: {
                    hasUserObject: !!req.user,
                },
            });
        }
        const items = await recycleBinService_1.RecycleBinService.getUserRecycledItems(userId, itemType);
        return res.status(200).json({
            success: true,
            items,
        });
    }
    catch (error) {
        logger_1.default.error("Error fetching recycled items:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
        });
    }
});
// Restore an item from the recycle bin
router.put("/restore", async (req, res) => {
    try {
        const { recycledItemId } = req.body;
        if (!recycledItemId) {
            return res.status(400).json({
                success: false,
                message: "Recycled item ID is required",
            });
        }
        // Use authenticated user ID
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
                debug: {
                    hasUserObject: !!req.user,
                },
            });
        }
        const result = await recycleBinService_1.RecycleBinService.restoreItem(userId, recycledItemId);
        return res.status(200).json({
            success: true,
            item: result,
        });
    }
    catch (error) {
        logger_1.default.error("Error restoring item:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
        });
    }
});
// Permanently delete an item from the recycle bin
router.delete("/", async (req, res) => {
    try {
        const recycledItemId = req.query.id;
        if (!recycledItemId) {
            return res.status(400).json({
                success: false,
                message: "Recycled item ID is required",
            });
        }
        // Use authenticated user ID
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
                debug: {
                    hasUserObject: !!req.user,
                },
            });
        }
        await recycleBinService_1.RecycleBinService.permanentlyDeleteItem(userId, recycledItemId);
        return res.status(200).json({
            success: true,
            message: "Item permanently deleted",
        });
    }
    catch (error) {
        logger_1.default.error("Error permanently deleting item:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
        });
    }
});
// Get recycle bin statistics
router.get("/stats", async (req, res) => {
    try {
        // Use authenticated user ID
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
                debug: {
                    hasUserObject: !!req.user,
                },
            });
        }
        const stats = await recycleBinService_1.RecycleBinService.getRecycleBinStats(userId);
        return res.status(200).json({
            success: true,
            stats,
        });
    }
    catch (error) {
        logger_1.default.error("Error fetching recycle bin stats:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
        });
    }
});
// Update retention period setting
router.put("/settings", async (req, res) => {
    try {
        const { retentionPeriod } = req.body;
        // Use authenticated user ID
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
                debug: {
                    hasUserObject: !!req.user,
                },
            });
        }
        // Validate retention period
        if (retentionPeriod === undefined ||
            retentionPeriod < 1 ||
            retentionPeriod > 365) {
            return res.status(400).json({
                success: false,
                message: "Retention period must be between 1 and 365 days",
            });
        }
        // Save this setting to the database
        await recycleBinService_1.RecycleBinService.setUserRetentionPeriod(userId, retentionPeriod);
        return res.status(200).json({
            success: true,
            message: "Retention period updated successfully",
            retentionPeriod,
        });
    }
    catch (error) {
        logger_1.default.error("Error updating recycle bin settings:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
        });
    }
});
// Permanently delete all non-restored items from the recycle bin
router.delete("/empty", async (req, res) => {
    try {
        // Use authenticated user ID
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
                debug: {
                    hasUserObject: !!req.user,
                },
            });
        }
        // Delete all non-restored items for this user
        const result = await prisma_1.prisma.recycledItem.deleteMany({
            where: {
                user_id: userId,
                restored_at: null,
            },
        });
        logger_1.default.info("Trash emptied for user", {
            userId,
            deletedCount: result.count,
        });
        return res.status(200).json({
            success: true,
            message: `Trash emptied successfully. ${result.count} items permanently deleted`,
            deletedCount: result.count,
        });
    }
    catch (error) {
        logger_1.default.error("Error emptying trash:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
        });
    }
});
// Get retention period setting
router.get("/settings", async (req, res) => {
    try {
        // Use authenticated user ID
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
                debug: {
                    hasUserObject: !!req.user,
                },
            });
        }
        // Fetch this setting from the database
        const retentionPeriod = await recycleBinService_1.RecycleBinService.getUserRetentionPeriod(userId);
        return res.status(200).json({
            success: true,
            retentionPeriod,
        });
    }
    catch (error) {
        logger_1.default.error("Error fetching recycle bin settings:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
        });
    }
});
exports.default = router;
