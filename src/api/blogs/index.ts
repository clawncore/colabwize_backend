import express, { Router } from "express";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";

const router: Router = express.Router();

/**
 * @route   GET /api/blogs
 * @desc    Fetch all published blog posts (public, no auth required)
 * @access  Public
 */
router.get("/", async (req, res) => {
  try {
    const blogs = await prisma.blogPost.findMany({
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
  } catch (error: any) {
    logger.error("Public Blogs Fetch Error:", error);
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

    const blog = await prisma.blogPost.findFirst({
      where: {
        slug,
        is_published: true
      }
    });

    if (!blog) {
      return res.status(404).json({ success: false, error: "Blog post not found" });
    }

    res.json({ success: true, blog });
  } catch (error: any) {
    logger.error("Public Blog Fetch Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
