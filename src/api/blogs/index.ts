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
        view_count: true,
        like_count: true,
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
 * @desc    Fetch a single published blog post by slug (public, no auth required).
 *          Increments view_count so the admin engagement stats show real reads.
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

    // Record a real view (best-effort — never fail the read because of this).
    await prisma.blogPost
      .update({
        where: { id: blog.id },
        data: { view_count: { increment: 1 } },
      })
      .catch((err: any) => logger.warn(`View count increment failed: ${err.message}`));

    res.json({ success: true, blog });
  } catch (error: any) {
    logger.error("Public Blog Fetch Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * @route   POST /api/blogs/:slug/engagement
 * @desc    Record reader engagement on a published post (e.g. a like).
 *          Public, no auth required — validated, rate-limited at the router mount.
 * @access  Public
 */
router.post("/:slug/engagement", async (req, res) => {
  try {
    const { slug } = req.params;
    const { type } = req.body || {};

    const blog = await prisma.blogPost.findFirst({
      where: { slug, is_published: true },
      select: { id: true },
    });

    if (!blog) {
      return res.status(404).json({ success: false, error: "Blog post not found" });
    }

    let field: "like_count" | null = null;
    if (type === "like") field = "like_count";

    if (!field) {
      return res.status(400).json({ success: false, error: "Unsupported engagement type" });
    }

    const updated = await prisma.blogPost.update({
      where: { id: blog.id },
      data: { [field]: { increment: 1 } },
      select: { [field]: true },
    });

    res.json({ success: true, count: (updated as any)[field] });
  } catch (error: any) {
    logger.error("Public Blog Engagement Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
