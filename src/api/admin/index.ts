import express, { Router } from "express";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { isPlatformAdmin } from "../../middleware/platformAdmin";
import { sendEmail } from "../../services/email/baseMailer";
import { SENDER_IDENTITIES, EmailSender } from "../../services/email/emailConfig";
import { wrapInPremiumLayout } from "../../services/email/emailLayout";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { processBroadcast } from "../../services/admin/broadcastService";

const router: Router = express.Router();

// Diagnostic route
router.get("/health", (req, res) => {
  res.json({ status: "active", router: "admin" });
});

// Base middleware for all admin routes
router.use(isPlatformAdmin);

/**
 * @route   POST /api/admin/email/send
 * @desc    Send an individual email
 * @access  Admin Only
 */
router.post("/email/send", async (req, res) => {
  try {
    const { to, senderAlias, subject, message, senderName, senderTitle } = req.body;

    if (!to || !senderAlias || !subject || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!Object.keys(SENDER_IDENTITIES).includes(senderAlias)) {
      return res.status(400).json({ error: "Invalid sender alias" });
    }

    const result = await sendEmail({
      from: senderAlias as EmailSender,
      to,
      subject,
      html: wrapInPremiumLayout(message, senderAlias as EmailSender, senderName, senderTitle, to),
      text: message.replace(/<[^>]+>/g, '') // Clean fallback text
    });

    // Audit Log Entry
    await prisma.emailLog.create({
      data: {
        recipient: to,
        sender: senderAlias,
        subject,
        status: result.success ? "sent" : "failed",
        error: result.success ? null : (result.error || "Unknown error")
      }
    });

    if (result.success) {
      return res.json({ success: true, message: "Email sent successfully", id: result.data?.id });
    } else {
      return res.status(500).json({ success: false, error: result.error || "Failed to send email" });
    }
  } catch (error: any) {
    logger.error("Admin Email Send Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * @route   POST /api/admin/email/generate
 * @desc    Generate a professional email draft using OpenAI
 * @access  Admin Only
 */
router.post("/email/generate", async (req, res) => {
  try {
    const { prompt, currentMessage } = req.body;
    
    if (!prompt) {
       return res.status(400).json({ error: "Missing prompt" });
    }

    let systemInstructions = `You are an expert corporate communications professional for 'ColabWize'. 
    
You must generate a beautifully formatted, professional body for an email. 
Note: The outer "card" layout, company branding, and signatures ARE ALREADY HANDLED. You should focus ONLY on the HTML content of the message itself.

Guidelines:
1. Use semantic HTML tags for structure: <h1> for titles, <p> for paragraphs, <ul>/<li> for lists.
2. For specific data or logs, use bold labels and clean line breaks (e.g., "<strong>Location:</strong> Boardman Oregon<br><br>").
3. You can include links using the <a> tag.
4. If a button is needed, generate a centered div with a link styled like a button (e.g., <div style="margin: 30px 0; text-align: center;"><a href="#" style="background-color: #0ea5e9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 12px; font-weight: bold; display: inline-block;">Button Text</a></div>).

RETURN ONLY THE HTML CONTENT STRING. Do not include <html>, <head>, or <body> tags. Do not wrap in markdown code blocks like \`\`\`html. Output the final, ready-to-use professional body content.`;
    let userInstructions = prompt;

    if (currentMessage) {
        systemInstructions += "\nThe user has provided an existing draft. You must comprehensively revise, correct, or enhance the existing draft according to their instructions.";
        userInstructions = `Instruction: ${prompt}\n\nCurrent Draft:\n${currentMessage}`;
    }

    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      system: systemInstructions,
      prompt: userInstructions,
    });

    res.json({ success: true, html: text });
  } catch (error: any) {
    logger.error("Admin AI Gen Error:", error);
    res.status(500).json({ success: false, error: "AI Generation failed" });
  }
});

/**
 * @route   POST /api/admin/email/broadcast
 * @desc    Send a broadcast email to multiple users
 * @access  Admin Only
 */
router.post("/email/broadcast", async (req, res) => {
  try {
    const { userIds, senderAlias, subject, message, senderName, senderTitle } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0 || !senderAlias || !subject || !message) {
      return res.status(400).json({ error: "Invalid or missing required fields" });
    }

    if (!Object.keys(SENDER_IDENTITIES).includes(senderAlias)) {
      return res.status(400).json({ error: "Invalid sender alias" });
    }

    let finalMessage = message;

    // Fire and forget: Process broadcast in background
    processBroadcast({
      userIds,
      senderAlias: senderAlias as EmailSender,
      subject,
      message: finalMessage,
      senderName,
      senderTitle
    }).catch(err => logger.error("Background Broadcast Error:", err));

    res.status(202).json({
      success: true,
      message: `Broadcast of ${userIds.length} emails has been initiated in the background.`
    });
  } catch (error: any) {
    logger.error("Admin Broadcast Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * @route   GET /api/admin/inbox
 * @desc    Fetch grouped support inbox threads
 * @access  Admin Only
 */
router.get("/inbox", async (req, res) => {
  try {
    const status = (req.query.status as string) || "open";

    let messages;
    // Original grouped thread logic for the main "All" view
    messages = await prisma.$queryRaw`
      SELECT t1.*
      FROM support_messages t1
      INNER JOIN (
          SELECT thread_id, MAX(received_at) as max_date
          FROM support_messages
          WHERE status = ${status}
          GROUP BY thread_id
      ) t2 ON t1.thread_id = t2.thread_id AND t1.received_at = t2.max_date
      ORDER BY t1.received_at DESC
      LIMIT 100
    `;

    res.json({ success: true, messages });
  } catch (error: any) {
    logger.error("Admin Inbox Fetch Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * @route   GET /api/admin/inbox/:threadId
 * @desc    Fetch all messages inside a thread
 * @access  Admin Only
 */
router.get("/inbox/:threadId", async (req, res) => {
  try {
    const { threadId } = req.params;

    const messages = await prisma.supportMessage.findMany({
      where: { thread_id: threadId },
      orderBy: { received_at: "asc" }
    });

    res.json({ success: true, messages });
  } catch (error: any) {
    logger.error("Admin Thread Fetch Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * @route   POST /api/admin/inbox/reply
 * @desc    Reply to a support thread
 * @access  Admin Only
 */
router.post("/inbox/reply", async (req, res) => {
  try {
    const { threadId, senderAlias, to, subject, message } = req.body;

    if (!threadId || !senderAlias || !to || !subject || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const fallbackText = message.replace(/<[^>]+>/g, '');

    // Send the email natively out through Resend
    const result = await sendEmail({
      from: senderAlias as EmailSender,
      to,
      subject,
      html: wrapInPremiumLayout(message, senderAlias as EmailSender, undefined, undefined, to),
      text: fallbackText
    });

    if (result.success) {
      // Append the admin's outbound reply into the SupportMessage table to maintain thread history
      await prisma.supportMessage.create({
        data: {
          sender_email: SENDER_IDENTITIES[senderAlias as EmailSender].replace(/.*<(.+)>/, '$1'),
          subject,
          message_html: message,
          message_text: fallbackText,
          status: 'open',
          thread_id: threadId,
          source_alias: senderAlias,
          imap_uid: Math.floor(Math.random() * 1000000000) // Dummy UID for locally generated outbound msg
        }
      });
      return res.json({ success: true });
    } else {
      return res.status(500).json({ success: false, error: result.error || "Failed to send reply" });
    }
  } catch (error: any) {
    logger.error("Admin Thread Reply Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * @route   PATCH /api/admin/inbox/:threadId/status
 * @desc    Close or Re-open a ticket thread
 * @access  Admin Only
 */
router.patch("/inbox/:threadId/status", async (req, res) => {
  try {
    const { threadId } = req.params;
    const { status } = req.body;

    if (status !== 'open' && status !== 'resolved') {
      return res.status(400).json({ error: "Invalid status state" });
    }

    await prisma.supportMessage.updateMany({
      where: { thread_id: threadId },
      data: { status }
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error("Admin Thread Status Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * @route   PATCH /api/admin/inbox/message/:id/read
 * @desc    Mark a specific message as read/unread
 * @access  Admin Only
 */
router.patch("/inbox/message/:id/read", async (req, res) => {
  try {
    const { id } = req.params;
    const { isRead } = req.body;

    await prisma.supportMessage.update({
      where: { id },
      data: { is_read: isRead }
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error("Admin Message Read Status Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});



/**
 * @route   GET /api/admin/email/logs
 * @desc    Fetch email sending logs
 * @access  Admin Only
 */
/**
 * @route   GET /api/admin/email/unsubscribed
 * @desc    Fetch all users who have opted out of marketing emails
 * @access  Admin Only
 */
router.get("/email/unsubscribed", async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { unsubscribed_from_marketing: true },
      select: {
        id: true,
        email: true,
        full_name: true,
        created_at: true,
      },
      orderBy: { created_at: "desc" }
    });

    res.json({ success: true, users, total: users.length });
  } catch (error: any) {
    logger.error("Admin Unsubscribed Fetch Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/email/logs", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    const logs = await prisma.emailLog.findMany({
      take: limit,
      skip: offset,
      orderBy: { sent_at: "desc" }
    });

    const total = await prisma.emailLog.count();

    res.json({ success: true, logs, total });
  } catch (error: any) {
    logger.error("Admin Log Fetch Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * @route   GET /api/admin/analytics
 * @desc    Fetch platform and email analytics
 * @access  Admin Only
 */
router.get("/analytics", async (req, res) => {
  try {
    // 1. Email stats
    const emailStats = await prisma.emailLog.groupBy({
      by: ['status'],
      _count: true
    });

    // 2. User Growth (Last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const userGrowth = await prisma.user.count({
      where: { created_at: { gte: thirtyDaysAgo } }
    });

    const totalUsers = await prisma.user.count();

    // 3. Plan Distribution
    // This assumes we have a subscription model or user.plan field. 
    // From our schema, it's subscription.plan
    const paidUsers = await prisma.subscription.count({
      where: { status: "active" }
    });

    const activeSupport = await prisma.supportMessage.count({
      where: { status: "open" }
    });

    const blogPosts = await prisma.blogPost.count();

    res.json({
      success: true,
      data: {
        emails: emailStats,
        growth: {
          last30Days: userGrowth,
          total: totalUsers
        },
        distribution: {
          paid: paidUsers,
          free: totalUsers - paidUsers
        },
        app: {
          activeSupport,
          blogPosts,
          marketingReach: totalUsers // Representing reach as total users
        }
      }
    });
  } catch (error: any) {
    logger.error("Admin Analytics Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * @route   GET /api/admin/users
 * @desc    Fetch application user list for the admin interface
 * @access  Admin Only
 */
router.get("/users", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const plan = req.query.plan as string | undefined; // 'free' | 'paid' | 'all'
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const search = req.query.search as string | undefined;

    const ADMIN_WHITELIST = ["simbisai@colabwize.com", "craig@colabwize.com"];

    const where: any = {
      AND: [
        {
          email: {
            notIn: ADMIN_WHITELIST,
          }
        },
        {
          email: {
            not: {
              contains: "@colabwize.com"
            }
          }
        }
      ]
    };

    if (search) {
      where.AND.push({
        OR: [
          { full_name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } }
        ]
      });
    }

    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) where.created_at.gte = new Date(dateFrom);
      if (dateTo) where.created_at.lte = new Date(dateTo);
    }

    if (plan === 'paid') {
      where.AND.push({
        subscription: {
          status: 'active'
        }
      });
    } else if (plan === 'free') {
      where.AND.push({
        OR: [
          { subscription: null },
          { subscription: { status: { not: 'active' } } }
        ]
      });
    }

    const usersList = await prisma.user.findMany({
      take: limit,
      skip: offset,
      where,
      select: {
        id: true,
        email: true,
        full_name: true,
        created_at: true,
        subscription: {
          select: { plan: true, status: true }
        }
      },
      orderBy: { created_at: "desc" }
    });

    const total = await prisma.user.count({ where });

    res.json({ users: usersList, total });
  } catch (error: any) {
    console.error("ADMIN USER FETCH ERROR:", error);
    logger.error("Admin User Fetch Error:", error);
    res.status(500).json({ success: false, error: error.message || "Internal server error" });
  }
});

/**
 * @route   GET /api/admin/blogs
 * @desc    Fetch all blog posts
 * @access  Admin Only
 */
router.get("/blogs", async (req, res) => {
  try {
    const blogs = await prisma.blogPost.findMany({
      orderBy: { created_at: "desc" }
    });
    res.json({ success: true, blogs });
  } catch (error: any) {
    logger.error("Admin Blogs Fetch Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * @route   POST /api/admin/blogs
 * @desc    Create a new blog post
 * @access  Admin Only
 */
router.post("/blogs", async (req, res) => {
  try {
    const { title, excerpt, content, author, category, image, is_published, published_at } = req.body;

    // Check for missing required fields specifically
    const missingFields = [];
    if (!title) missingFields.push("title");
    if (!excerpt) missingFields.push("excerpt");
    if (!content) missingFields.push("content");
    if (!author) missingFields.push("author");
    if (!category) missingFields.push("category");

    if (missingFields.length > 0) {
      return res.status(400).json({ 
        error: `Missing required fields: ${missingFields.join(", ")}`,
        missingFields 
      });
    }

    const slug = title.toLowerCase().replace(/ /g, "-").replace(/[^\w-]+/g, "");

    const blog = await prisma.blogPost.create({
      data: {
        title,
        slug,
        excerpt,
        content,
        author,
        category,
        image,
        is_published: is_published || false,
        published_at: published_at ? new Date(published_at) : null,
        author_id: (req as any).user?.id
      }
    });

    res.json({ success: true, blog });
  } catch (error: any) {
    logger.error("Admin Blog Create Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * @route   PATCH /api/admin/blogs/:id
 * @desc    Update a blog post
 * @access  Admin Only
 */
router.patch("/blogs/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, excerpt, content, author, category, image, is_published, published_at } = req.body;

    const data: any = {};
    if (title !== undefined) {
      data.title = title;
      data.slug = title.toLowerCase().replace(/ /g, "-").replace(/[^\w-]+/g, "");
    }
    if (excerpt !== undefined) data.excerpt = excerpt;
    if (content !== undefined) data.content = content;
    if (author !== undefined) data.author = author;
    if (category !== undefined) data.category = category;
    if (image !== undefined) data.image = image;
    if (is_published !== undefined) data.is_published = is_published;
    if (published_at !== undefined) data.published_at = published_at ? new Date(published_at) : null;

    const blog = await prisma.blogPost.update({
      where: { id },
      data
    });

    res.json({ success: true, blog });
  } catch (error: any) {
    logger.error("Admin Blog Update Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * @route   DELETE /api/admin/blogs/:id
 * @desc    Delete a blog post
 * @access  Admin Only
 */
router.delete("/blogs/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.blogPost.delete({
      where: { id }
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error("Admin Blog Delete Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;

