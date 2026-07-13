"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const platformAdmin_1 = require("../../middleware/platformAdmin");
const baseMailer_1 = require("../../services/email/baseMailer");
const emailConfig_1 = require("../../services/email/emailConfig");
const emailLayout_1 = require("../../services/email/emailLayout");
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const broadcastService_1 = require("../../services/admin/broadcastService");
const router = express_1.default.Router();
// Diagnostic route
router.get("/health", (req, res) => {
    res.json({ status: "active", router: "admin" });
});
// Base middleware for all admin routes
router.use(platformAdmin_1.isPlatformAdmin);
/**
 * @route   POST /api/admin/email/send
 * @desc    Send an individual email
 * @access  Admin Only
 */
router.post("/email/send", async (req, res) => {
    try {
        const { to, senderAlias, subject, message } = req.body;
        if (!to || !senderAlias || !subject || !message) {
            return res.status(400).json({ error: "Missing required fields" });
        }
        if (!Object.keys(emailConfig_1.SENDER_IDENTITIES).includes(senderAlias)) {
            return res.status(400).json({ error: "Invalid sender alias" });
        }
        // Wrap in premium layout (banner, styling, signature) so email clients
        // render the HTML properly instead of showing raw text.
        const finalHtml = (0, emailLayout_1.wrapInPremiumLayout)(message, senderAlias);
        const fallbackText = message.replace(/<[^>]+>/g, '');
        const result = await (0, baseMailer_1.sendEmail)({
            from: senderAlias,
            to,
            subject,
            html: finalHtml,
            text: fallbackText
        });
        // Audit Log Entry — store the real "from" address and the message body so
        // the admin Sentbox can show what was sent and from which address.
        await prisma_1.prisma.emailLog.create({
            data: {
                recipient: to,
                sender: senderAlias,
                from_address: emailConfig_1.SENDER_IDENTITIES[senderAlias],
                subject,
                status: result.success ? "sent" : "failed",
                error: result.success ? null : (result.error || "Unknown error"),
                message_body: message,
            }
        });
        if (result.success) {
            return res.json({ success: true, message: "Email sent successfully", id: result.data?.id });
        }
        else {
            return res.status(500).json({ success: false, error: result.error || "Failed to send email" });
        }
    }
    catch (error) {
        logger_1.default.error("Admin Email Send Error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});
/**
 * @route   POST /api/admin/email/broadcast
 * @desc    Send a broadcast email to multiple users
 * @access  Admin Only
 */
router.post("/email/broadcast", async (req, res) => {
    try {
        const { userIds, senderAlias, subject, message } = req.body;
        if (!Array.isArray(userIds) || userIds.length === 0 || !senderAlias || !subject || !message) {
            return res.status(400).json({ error: "Invalid or missing required fields" });
        }
        if (!Object.keys(emailConfig_1.SENDER_IDENTITIES).includes(senderAlias)) {
            return res.status(400).json({ error: "Invalid sender alias" });
        }
        // Fire and forget: Process broadcast in background. Pass the resolved
        // "from" address so every log row records which mailbox sent it.
        const fromAddress = emailConfig_1.SENDER_IDENTITIES[senderAlias];
        (0, broadcastService_1.processBroadcast)({
            userIds,
            senderAlias: senderAlias,
            subject,
            message,
            fromAddress,
        }).catch(err => logger_1.default.error("Background Broadcast Error:", err));
        res.status(202).json({
            success: true,
            message: `Broadcast of ${userIds.length} emails has been initiated in the background.`
        });
    }
    catch (error) {
        logger_1.default.error("Admin Broadcast Error:", error);
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
        const status = req.query.status || "open";
        const folder = req.query.folder;
        let messages;
        if (folder) {
            // If a specific folder is requested, we filter by it
            messages = await prisma_1.prisma.supportMessage.findMany({
                where: {
                    status,
                    folder
                },
                orderBy: { received_at: "desc" },
                take: 100
            });
        }
        else {
            // Original grouped thread logic for the main "All" view
            messages = await prisma_1.prisma.$queryRaw `
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
        }
        res.json({ success: true, messages });
    }
    catch (error) {
        logger_1.default.error("Admin Inbox Fetch Error:", error);
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
        const messages = await prisma_1.prisma.supportMessage.findMany({
            where: { thread_id: threadId },
            orderBy: { received_at: "asc" }
        });
        res.json({ success: true, messages });
    }
    catch (error) {
        logger_1.default.error("Admin Thread Fetch Error:", error);
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
        // Wrap in premium layout so the reply renders properly in email clients
        const finalHtml = (0, emailLayout_1.wrapInPremiumLayout)(message, senderAlias);
        const fallbackText = message.replace(/<[^>]+>/g, '');
        // Send the email natively out through Resend
        const result = await (0, baseMailer_1.sendEmail)({
            from: senderAlias,
            to,
            subject,
            html: finalHtml,
            text: fallbackText
        });
        if (result.success) {
            // Append the admin's outbound reply into the SupportMessage table to maintain thread history
            await prisma_1.prisma.supportMessage.create({
                data: {
                    sender_email: emailConfig_1.SENDER_IDENTITIES[senderAlias].replace(/.*<(.+)>/, '$1'),
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
        }
        else {
            return res.status(500).json({ success: false, error: result.error || "Failed to send reply" });
        }
    }
    catch (error) {
        logger_1.default.error("Admin Thread Reply Error:", error);
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
        await prisma_1.prisma.supportMessage.updateMany({
            where: { thread_id: threadId },
            data: { status }
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("Admin Thread Status Error:", error);
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
        await prisma_1.prisma.supportMessage.update({
            where: { id },
            data: { is_read: isRead }
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("Admin Message Read Status Error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});
/**
 * @route   PATCH /api/admin/inbox/message/:id/folder
 * @desc    Move a message to a specific folder
 * @access  Admin Only
 */
router.patch("/inbox/message/:id/folder", async (req, res) => {
    try {
        const { id } = req.params;
        const { folder } = req.body;
        await prisma_1.prisma.supportMessage.update({
            where: { id },
            data: { folder }
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("Admin Message Folder Update Error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});
/**
 * @route   GET /api/admin/inbox/stats/folders
 * @desc    Get unread counts for all folders
 * @access  Admin Only
 */
router.get("/inbox/stats/folders", async (req, res) => {
    try {
        const counts = await prisma_1.prisma.supportMessage.groupBy({
            by: ['folder'],
            where: { is_read: false, status: 'open' },
            _count: true
        });
        res.json({ success: true, counts });
    }
    catch (error) {
        logger_1.default.error("Admin Folder Stats Error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});
/**
 * @route   GET /api/admin/email/logs
 * @desc    Fetch email sending logs
 * @access  Admin Only
 */
router.get("/email/logs", async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        const logs = await prisma_1.prisma.emailLog.findMany({
            take: limit,
            skip: offset,
            orderBy: { sent_at: "desc" },
            select: {
                id: true,
                recipient: true,
                sender: true,
                from_address: true,
                subject: true,
                status: true,
                sent_at: true,
                error: true,
                message_body: true,
            }
        });
        const total = await prisma_1.prisma.emailLog.count();
        res.json({ success: true, logs, total });
    }
    catch (error) {
        logger_1.default.error("Admin Log Fetch Error:", error);
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
        const emailStats = await prisma_1.prisma.emailLog.groupBy({
            by: ['status'],
            _count: true
        });
        // 2. User Growth (Last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const userGrowth = await prisma_1.prisma.user.count({
            where: { created_at: { gte: thirtyDaysAgo } }
        });
        const totalUsers = await prisma_1.prisma.user.count();
        // 3. Plan Distribution
        // This assumes we have a subscription model or user.plan field. 
        // From our schema, it's subscription.plan
        const paidUsers = await prisma_1.prisma.subscription.count({
            where: { status: "active" }
        });
        const activeSupport = await prisma_1.prisma.supportMessage.count({
            where: { status: "open" }
        });
        const blogPosts = await prisma_1.prisma.blogPost.count();
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
    }
    catch (error) {
        logger_1.default.error("Admin Analytics Error:", error);
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
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        const plan = req.query.plan; // 'free' | 'paid' | 'all'
        const dateFrom = req.query.dateFrom;
        const dateTo = req.query.dateTo;
        const search = req.query.search;
        const ADMIN_WHITELIST = ["simbisai@colabwize.com", "craig@colabwize.com", "craign@colabwize.com"];
        const where = {
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
            if (dateFrom)
                where.created_at.gte = new Date(dateFrom);
            if (dateTo)
                where.created_at.lte = new Date(dateTo);
        }
        if (plan === 'paid') {
            where.AND.push({
                subscription: {
                    status: 'active'
                }
            });
        }
        else if (plan === 'free') {
            where.AND.push({
                OR: [
                    { subscription: null },
                    { subscription: { status: { not: 'active' } } }
                ]
            });
        }
        const usersList = await prisma_1.prisma.user.findMany({
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
        const total = await prisma_1.prisma.user.count({ where });
        res.json({ users: usersList, total });
    }
    catch (error) {
        console.error("ADMIN USER FETCH ERROR:", error);
        logger_1.default.error("Admin User Fetch Error:", error);
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
        const blogs = await prisma_1.prisma.blogPost.findMany({
            orderBy: { created_at: "desc" }
        });
        res.json({ success: true, blogs });
    }
    catch (error) {
        logger_1.default.error("Admin Blogs Fetch Error:", error);
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
        const { title, excerpt, content, author, category, image, is_published } = req.body;
        if (!title || !excerpt || !content || !author || !category) {
            return res.status(400).json({ error: "Missing required fields" });
        }
        const slug = title.toLowerCase().replace(/ /g, "-").replace(/[^\w-]+/g, "");
        const blog = await prisma_1.prisma.blogPost.create({
            data: {
                title,
                slug,
                excerpt,
                content,
                author,
                category,
                image,
                is_published: is_published || false,
                author_id: req.user?.id // Assuming user ID is attached by middleware
            }
        });
        res.json({ success: true, blog });
    }
    catch (error) {
        logger_1.default.error("Admin Blog Create Error:", error);
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
        const updateData = req.body;
        if (updateData.title) {
            updateData.slug = updateData.title.toLowerCase().replace(/ /g, "-").replace(/[^\w-]+/g, "");
        }
        const blog = await prisma_1.prisma.blogPost.update({
            where: { id },
            data: updateData
        });
        res.json({ success: true, blog });
    }
    catch (error) {
        logger_1.default.error("Admin Blog Update Error:", error);
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
        await prisma_1.prisma.blogPost.delete({
            where: { id }
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("Admin Blog Delete Error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});
exports.default = router;
