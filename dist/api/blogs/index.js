"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const router = express_1.default.Router();
/**
 * @route   GET /api/blogs
 * @desc    Fetch all published blog posts (public, no auth required)
 * @access  Public
 */
router.get("/", async (req, res) => {
    try {
        const blogs = await prisma_1.prisma.blogPost.findMany({
            where: { is_published: true },
            orderBy: { published_at: "desc" },
            select: {
                id: true,
                slug: true,
                title: true,
                excerpt: true,
                author: true,
                category: true,
                image: true,
                read_time: true,
                created_at: true,
                published_at: true,
            }
        });
        res.json({ success: true, blogs });
    }
    catch (error) {
        logger_1.default.error("Public Blogs Fetch Error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});
/**
 * @route   GET /api/blogs/:slug
 * @desc    Fetch a single published blog post by slug (public, no auth required)
 * @access  Public
 */
router.get("/:slug", async (req, res) => {
    try {
        const { slug } = req.params;
        const blog = await prisma_1.prisma.blogPost.findFirst({
            where: {
                slug,
                is_published: true
            }
        });
        if (!blog) {
            return res.status(404).json({ success: false, error: "Blog post not found" });
        }
        res.json({ success: true, blog });
    }
    catch (error) {
        logger_1.default.error("Public Blog Fetch Error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});
exports.default = router;
