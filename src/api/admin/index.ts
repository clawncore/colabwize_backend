import express, { Router } from "express";
import { isPlatformAdmin } from "../../middleware/platformAdmin";
import { sendEmail } from "../../services/email/baseMailer";
import { SENDER_IDENTITIES, EmailSender } from "../../services/email/emailConfig";
import { wrapInPremiumLayout } from "../../services/email/emailLayout";
<<<<<<< HEAD
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { processBroadcast } from "../../services/admin/broadcastService";

const router: Router = express.Router();

=======
import { buildEmailAssistantPrompt } from "../../knowledge";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { processBroadcast } from "../../services/admin/broadcastService";
import { createAuditLog, extractAuditContext, getAdminEmail } from "../../services/admin/auditLogService";
import { OpenAIService } from "../../services/openaiService";
import { TeamChatService } from "../../services/teamChatService";
import integrationsRouter from "./integrations";
import analyticsRouter from "./analytics";
import revenueRouter from "./revenue";

const router: Router = express.Router();

// Mount revenue router
router.use("/revenue", revenueRouter);

>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
// Diagnostic route
router.get("/health", (req, res) => {
  res.json({ status: "active", router: "admin" });
});

<<<<<<< HEAD
=======
/**
 * @route   GET /api/admin/presence/stats
 * @desc    Get real-time user presence statistics
 * @access  Admin Only
 */
router.get("/presence/stats", async (req, res) => {
  try {
    const stats = await TeamChatService.getPresenceStats();
    res.json({ success: true, data: stats });
  } catch (error: any) {
    logger.error("Admin Presence Stats Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * @route   GET /api/admin/presence/online
 * @desc    Get list of currently online users
 * @access  Admin Only
 */
router.get("/presence/online", async (req, res) => {
  try {
    const onlineUsers = await TeamChatService.getOnlineUsers();
    res.json({ success: true, users: onlineUsers });
  } catch (error: any) {
    logger.error("Admin Online Users Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
// Base middleware for all admin routes
router.use(isPlatformAdmin);

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

    if (!Object.keys(SENDER_IDENTITIES).includes(senderAlias)) {
      return res.status(400).json({ error: "Invalid sender alias" });
    }

    // Wrap in premium layout (banner, styling, signature) so email clients
    // render the HTML properly instead of showing raw text.
    const finalHtml = wrapInPremiumLayout(message, senderAlias as EmailSender);
    const fallbackText = message.replace(/<[^>]+>/g, '');

    const result = await sendEmail({
      from: senderAlias as EmailSender,
      to,
      subject,
      html: finalHtml,
      text: fallbackText
    });

<<<<<<< HEAD
    // Audit Log Entry — store the real "from" address and the message body so
    // the admin Sentbox can show what was sent and from which address.
    await prisma.emailLog.create({
      data: {
        recipient: to,
        sender: senderAlias,
        from_address: SENDER_IDENTITIES[senderAlias as EmailSender],
        subject,
        status: result.success ? "sent" : "failed",
        error: result.success ? null : (result.error || "Unknown error"),
        message_body: message,
      }
    });

    if (result.success) {
=======
    // Email is automatically logged by baseMailer.sendEmail()

    if (result.success) {
      await createAuditLog({
        action: "EMAIL_SENT",
        adminEmail: getAdminEmail(req),
        entityType: "EmailLog",
        metadata: { to, senderAlias, subject },
        ...extractAuditContext(req),
      });
>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
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
<<<<<<< HEAD
=======
 * @route   POST /api/admin/email/generate
 * @desc    Generate email content using AI (supports multi-turn chat)
 * @access  Admin Only
 */
router.post("/email/generate", async (req, res) => {
  try {
    const { prompt, currentMessage, chatHistory } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing or invalid prompt" });
    }

    const systemMessage = buildEmailAssistantPrompt({ messageText: prompt });

    // Build messages array with chat history for multi-turn conversation
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemMessage },
    ];

    // Add chat history if provided (last 10 messages for context window management)
    if (Array.isArray(chatHistory) && chatHistory.length > 0) {
      const recentHistory = chatHistory.slice(-10);
      for (const msg of recentHistory) {
        messages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        });
      }
    }

    // Add current prompt with optional email context
    const userMessage = currentMessage
      ? `Here is the current email draft I'm working on:\n---\n${currentMessage}\n---\n\nMy request: ${prompt}`
      : prompt;

    messages.push({ role: "user", content: userMessage });

    const generated = await OpenAIService.generateCompletion(messages, {
      maxTokens: 2000,
      temperature: 0.7,
      model: "gpt-4o-mini",
    });

    await createAuditLog({
      action: "EMAIL_AI_GENERATED",
      adminEmail: getAdminEmail(req),
      entityType: "EmailLog",
      metadata: { prompt: prompt.substring(0, 100) },
      ...extractAuditContext(req),
    });

    res.json({ success: true, html: generated });
  } catch (error: any) {
    logger.error("Admin Email Generate Error:", error);
    res.status(500).json({ success: false, error: "Failed to generate email content" });
  }
});

/**
 * @route   POST /api/admin/email/search-support
 * @desc    Search support messages by sender name or email
 * @access  Admin Only
 */
router.post("/email/search-support", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Missing search query" });
    }

    const q = query.trim();
    // Search by email (exact or partial) or by name in subject/message
    const messages = await prisma.supportMessage.findMany({
      where: {
        OR: [
          { sender_email: { contains: q, mode: "insensitive" } },
          { subject: { contains: q, mode: "insensitive" } },
          { message_text: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { received_at: "desc" },
      take: 20,
      select: {
        id: true,
        sender_email: true,
        subject: true,
        message_text: true,
        received_at: true,
        status: true,
        thread_id: true,
        folder: true,
        priority: true,
      },
    });

    // Group by sender to show unique contacts
    const senderMap = new Map<string, { email: string; count: number; latest: string; subjects: string[] }>();
    for (const msg of messages) {
      const existing = senderMap.get(msg.sender_email);
      if (existing) {
        existing.count++;
        if (!existing.subjects.includes(msg.subject)) existing.subjects.push(msg.subject);
      } else {
        senderMap.set(msg.sender_email, {
          email: msg.sender_email,
          count: 1,
          latest: msg.received_at.toISOString(),
          subjects: [msg.subject],
        });
      }
    }

    res.json({
      success: true,
      messages,
      contacts: Array.from(senderMap.values()),
    });
  } catch (error: any) {
    logger.error("Support search error:", error);
    res.status(500).json({ success: false, error: "Search failed" });
  }
});

/**
 * @route   POST /api/admin/email/smart-reply
 * @desc    Auto-fetch support messages for a person and generate a contextual reply
 * @access  Admin Only
 */
router.post("/email/smart-reply", async (req, res) => {
  try {
    const { senderEmail, senderName, chatHistory } = req.body;

    if (!senderEmail && !senderName) {
      return res.status(400).json({ error: "Provide senderEmail or senderName" });
    }

    const searchQuery = senderEmail || senderName;

    // Check if search query is a ticket number (CW-YYYY-XXXX)
    const isTicket = /^CW-\d{4}-\d{4,}$/i.test(searchQuery);

    let contactRequest = null;
    if (isTicket) {
      contactRequest = await prisma.contactRequest.findFirst({
        where: { ticket_number: { equals: searchQuery, mode: "insensitive" } },
        include: { attachments: true },
      });
    }

    // Fetch support messages for this person
    const messages = await prisma.supportMessage.findMany({
      where: {
        OR: [
          { sender_email: { contains: searchQuery, mode: "insensitive" } },
          { subject: { contains: searchQuery, mode: "insensitive" } },
        ],
      },
      orderBy: { received_at: "desc" },
      take: 10,
      select: {
        sender_email: true,
        subject: true,
        message_text: true,
        received_at: true,
        status: true,
        folder: true,
        priority: true,
      },
    });

    if (messages.length === 0 && !contactRequest) {
      return res.json({
        success: true,
        found: false,
        message: `No support messages found for "${searchQuery}". Try pasting the email content directly.`,
      });
    }

    // Build context from contact request if found
    let contactContext = "";
    if (contactRequest) {
      const attachmentInfo = contactRequest.attachments.length > 0
        ? `\nAttachments: ${contactRequest.attachments.map((a: { file_name: string }) => a.file_name).join(", ")}`
        : "";
      contactContext = `
CONTACT TICKET: ${contactRequest.ticket_number}
From: ${contactRequest.name} <${contactRequest.email}>
Subject: ${contactRequest.subject}
Status: ${contactRequest.status}
Date: ${contactRequest.created_at.toISOString()}
Message: ${contactRequest.message}${attachmentInfo}
---`;
    }

    // Build context from their messages
    const messageContext = messages
      .map(
        (m: any) =>
          `[${m.received_at.toISOString().split("T")[0]}] From: ${m.sender_email} | Subject: ${m.subject} | Folder: ${m.folder || "Support"} | Priority: ${m.priority || "medium"}\n${m.message_text}`
      )
      .join("\n\n---\n\n");

    const latestSubject = contactRequest?.subject || messages[0]?.subject || "";
    const latestMessage = contactRequest?.message || messages[0]?.message_text || "";

    const systemMessage = buildEmailAssistantPrompt({
      messageText: latestMessage,
    });

    // Build messages for AI
    const aiMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemMessage },
    ];

    // Add chat history for context (last 6 messages)
    if (Array.isArray(chatHistory) && chatHistory.length > 0) {
      for (const msg of chatHistory.slice(-6)) {
        aiMessages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        });
      }
    }

    // Add the person's message history as context
    const contextParts = [];
    if (contactContext) {
      contextParts.push(contactContext);
    }
    if (messageContext) {
      contextParts.push(`Support message history:\n\n${messageContext}`);
    }

    aiMessages.push({
      role: "user",
      content: `Here is the context for this ticket:\n\n${contextParts.join("\n\n")}\n\nPlease draft a professional reply to: "${latestSubject}". Address their specific concern and provide a clear next step.`,
    });

    const generated = await OpenAIService.generateCompletion(aiMessages, {
      maxTokens: 2000,
      temperature: 0.7,
      model: "gpt-4o-mini",
    });

    await createAuditLog({
      action: "EMAIL_SMART_REPLY",
      adminEmail: getAdminEmail(req),
      entityType: "EmailLog",
      metadata: { senderEmail: messages[0].sender_email, messageCount: messages.length },
      ...extractAuditContext(req),
    });

    res.json({
      success: true,
      found: true,
      html: generated,
      sender: messages[0].sender_email,
      subject: latestSubject,
      messageCount: messages.length,
    });
  } catch (error: any) {
    logger.error("Smart reply error:", error);
    res.status(500).json({ success: false, error: "Failed to generate smart reply" });
  }
});

/**
>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
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

    if (!Object.keys(SENDER_IDENTITIES).includes(senderAlias)) {
      return res.status(400).json({ error: "Invalid sender alias" });
    }

    // Fire and forget: Process broadcast in background. Pass the resolved
    // "from" address so every log row records which mailbox sent it.
    const fromAddress = SENDER_IDENTITIES[senderAlias as EmailSender];
    processBroadcast({
      userIds,
      senderAlias: senderAlias as EmailSender,
      subject,
      message,
      fromAddress,
    }).catch(err => logger.error("Background Broadcast Error:", err));

<<<<<<< HEAD
=======
    await createAuditLog({
      action: "EMAIL_BROADCAST",
      adminEmail: getAdminEmail(req),
      entityType: "EmailLog",
      metadata: { recipientCount: userIds.length, senderAlias, subject },
      ...extractAuditContext(req),
    });

>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
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
<<<<<<< HEAD
=======
 * @route   GET /api/admin/inbox/sent
 * @desc    Fetch sent messages from email_logs (replies sent from inbox)
 * @access  Admin Only
 */
router.get("/inbox/sent", async (req, res) => {
  try {
    const messages = await prisma.emailLog.findMany({
      where: {
        sender: { in: ["support@colabwize.com", "help@colabwize.com", "billing@colabwize.com"] },
      },
      orderBy: { sent_at: "desc" },
      take: 100,
      select: {
        id: true,
        recipient: true,
        sender: true,
        subject: true,
        status: true,
        sent_at: true,
        message_body: true,
      },
    });

    // Format as inbox-style messages
    const formatted = messages.map((msg: any) => ({
      id: msg.id,
      sender_email: msg.recipient,
      subject: msg.subject,
      message_text: msg.message_body || "",
      received_at: msg.sent_at,
      status: msg.status,
      is_read: true,
      folder: "Sent",
      source_alias: msg.sender,
      thread_id: msg.id,
    }));

    res.json({ success: true, messages: formatted });
  } catch (error: any) {
    logger.error("Sent messages error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch sent messages" });
  }
});

/**
>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
 * @route   GET /api/admin/inbox
 * @desc    Fetch grouped support inbox threads
 * @access  Admin Only
 */
router.get("/inbox", async (req, res) => {
  try {
    const status = (req.query.status as string) || "open";
    const folder = (req.query.folder as string);

    let messages;

    if (folder) {
      // If a specific folder is requested, we filter by it
      messages = await prisma.supportMessage.findMany({
        where: {
          status,
          folder
        },
        orderBy: { received_at: "desc" },
        take: 100
      });
    } else {
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
    }

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
<<<<<<< HEAD
      orderBy: { received_at: "asc" }
=======
      orderBy: { received_at: "asc" },
      take: 100, // Limit messages per thread
>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
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

    // Wrap in premium layout so the reply renders properly in email clients
    const finalHtml = wrapInPremiumLayout(message, senderAlias as EmailSender);
    const fallbackText = message.replace(/<[^>]+>/g, '');

    // Send the email natively out through Resend
    const result = await sendEmail({
      from: senderAlias as EmailSender,
      to,
      subject,
      html: finalHtml,
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
<<<<<<< HEAD
=======
      await createAuditLog({
        action: "INBOX_REPLY_SENT",
        adminEmail: getAdminEmail(req),
        entityType: "SupportMessage",
        metadata: { threadId, to, subject },
        ...extractAuditContext(req),
      });
>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
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

<<<<<<< HEAD
=======
    await createAuditLog({
      action: "THREAD_STATUS_CHANGED",
      adminEmail: getAdminEmail(req),
      entityType: "SupportMessage",
      entityId: threadId,
      metadata: { status },
      ...extractAuditContext(req),
    });

>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
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
 * @route   PATCH /api/admin/inbox/message/:id/folder
 * @desc    Move a message to a specific folder
 * @access  Admin Only
 */
router.patch("/inbox/message/:id/folder", async (req, res) => {
  try {
    const { id } = req.params;
    const { folder } = req.body;

    await prisma.supportMessage.update({
      where: { id },
      data: { folder }
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error("Admin Message Folder Update Error:", error);
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
    const counts = await prisma.supportMessage.groupBy({
      by: ['folder'],
      where: { is_read: false, status: 'open' },
      _count: true
    });

    res.json({ success: true, counts });
  } catch (error: any) {
    logger.error("Admin Folder Stats Error:", error);
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
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
<<<<<<< HEAD

    const logs = await prisma.emailLog.findMany({
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

    const total = await prisma.emailLog.count();

    res.json({ success: true, logs, total });
=======
    const senderFilter = req.query.sender as string | undefined;
    const recipientFilter = req.query.recipient as string | undefined;

    const where: any = {};
    if (senderFilter && senderFilter !== "all") {
      where.sender = senderFilter;
    }
    if (recipientFilter) {
      where.recipient = recipientFilter;
    }

    const [logs, total, senderCounts] = await Promise.all([
      prisma.emailLog.findMany({
        take: limit,
        skip: offset,
        orderBy: { sent_at: "desc" },
        where,
        select: {
          id: true,
          recipient: true,
          sender: true,
          subject: true,
          status: true,
          sent_at: true,
          error: true,
          message_body: true,
        }
      }),
      prisma.emailLog.count({ where }),
      prisma.emailLog.groupBy({
        by: ['sender'],
        _count: true,
        orderBy: { sender: 'asc' },
      }),
    ]);

    const tabs = senderCounts.map((s: any) => ({
      sender: s.sender,
      count: s._count,
    }));

    res.json({ success: true, logs, total, tabs });
>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
  } catch (error: any) {
    logger.error("Admin Log Fetch Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
<<<<<<< HEAD
=======
 * @route   GET /api/admin/email/analytics
 * @desc    Comprehensive email analytics — totals, per-sender breakdown,
 *          delivery rate, recent daily volume, top recipients.
 * @access  Admin Only
 */
router.get("/email/analytics", async (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalEmails,
      emailsToday,
      emailsYesterday,
      emailsLast7d,
      emailsLast30d,
      statusBreakdown,
      senderBreakdown,
      recentDaily,
      topRecipients,
      subjectBreakdown,
      failedEmails,
      uniqueRecipients,
      hourlyDistribution,
      weeklyTrend,
      topFailingRecipients,
      recentFailed,
    ] = await Promise.all([
      prisma.emailLog.count(),
      prisma.emailLog.count({ where: { sent_at: { gte: today } } }),
      prisma.emailLog.count({ where: { sent_at: { gte: yesterday, lt: today } } }),
      prisma.emailLog.count({ where: { sent_at: { gte: sevenDaysAgo } } }),
      prisma.emailLog.count({ where: { sent_at: { gte: thirtyDaysAgo } } }),
      prisma.emailLog.groupBy({ by: ['status'], _count: true }),
      prisma.emailLog.groupBy({ by: ['sender'], _count: true, orderBy: { _count: { sender: 'desc' } } }),
      prisma.$queryRaw`
        SELECT DATE(sent_at) as date, COUNT(*)::int as count, status
        FROM email_logs
        GROUP BY DATE(sent_at), status
        ORDER BY date DESC
      `,
      prisma.emailLog.groupBy({ by: ['recipient'], _count: true, orderBy: { _count: { recipient: 'desc' } }, take: 20 }),
      prisma.emailLog.groupBy({ by: ['subject'], _count: true, orderBy: { _count: { subject: 'desc' } }, take: 20 }),
      prisma.emailLog.findMany({ where: { status: 'failed' }, select: { id: true, recipient: true, sender: true, subject: true, error: true, sent_at: true }, orderBy: { sent_at: 'desc' }, take: 50 }),
      prisma.$queryRaw`SELECT COUNT(DISTINCT recipient)::int as count FROM email_logs`,
      prisma.$queryRaw`
        SELECT EXTRACT(HOUR FROM sent_at)::int as hour, COUNT(*)::int as count
        FROM email_logs
        GROUP BY EXTRACT(HOUR FROM sent_at)
        ORDER BY hour
      `,
      prisma.$queryRaw`
        SELECT DATE(sent_at) as date, COUNT(*)::int as count
        FROM email_logs
        GROUP BY DATE(sent_at)
        ORDER BY date ASC
      `,
      prisma.$queryRaw`
        SELECT recipient, COUNT(*)::int as fail_count, ARRAY_AGG(DISTINCT subject) as subjects
        FROM email_logs
        WHERE status = 'failed'
        GROUP BY recipient
        ORDER BY fail_count DESC
        LIMIT 10
      `,
      prisma.emailLog.findMany({ where: { status: 'failed' }, select: { id: true, recipient: true, sender: true, subject: true, error: true, sent_at: true }, orderBy: { sent_at: 'desc' }, take: 5 }),
    ]);

    const sentCount = statusBreakdown.find((s: any) => s.status === "sent")?._count || 0;
    const failedCount = statusBreakdown.find((s: any) => s.status === "failed")?._count || 0;
    const deliveryRate = totalEmails > 0 ? Number(((sentCount / totalEmails) * 100).toFixed(1)) : 0;
    const uniqueRecipientCount = Array.isArray(uniqueRecipients) ? uniqueRecipients[0]?.count || 0 : 0;

    const dayOverDayChange = emailsYesterday > 0 ? Number((((emailsToday - emailsYesterday) / emailsYesterday) * 100).toFixed(1)) : 0;

    const errorCategories: Record<string, number> = {};
    for (const email of failedEmails) {
      const err = email.error || 'Unknown error';
      let category = 'Other';
      const lower = err.toLowerCase();
      if (lower.includes('bounce') || lower.includes('undeliverable')) category = 'Bounced';
      else if (lower.includes('spam') || lower.includes('rejected')) category = 'Spam/Rejected';
      else if (lower.includes('rate') || lower.includes('throttl')) category = 'Rate Limited';
      else if (lower.includes('auth') || lower.includes('dkim') || lower.includes('spf') || lower.includes('dmarc')) category = 'Authentication';
      else if (lower.includes('timeout') || lower.includes('network') || lower.includes('connection')) category = 'Network';
      else if (lower.includes('invalid') || lower.includes('format')) category = 'Invalid Address';
      errorCategories[category] = (errorCategories[category] || 0) + 1;
    }

    const hourlyMap: Record<number, number> = {};
    for (let h = 0; h < 24; h++) hourlyMap[h] = 0;
    for (const row of (hourlyDistribution as any[])) {
      hourlyMap[row.hour] = row.count;
    }
    const peakHour = Object.entries(hourlyMap).reduce((a, b) => b[1] > a[1] ? b : a, ['0', 0]);

    const avgDaily = weeklyTrend.length > 0 ? Number(((weeklyTrend as any[]).reduce((sum: number, r: any) => sum + r.count, 0) / (weeklyTrend as any[]).length).toFixed(1)) : 0;

    res.json({
      success: true,
      data: {
        totals: {
          allTime: totalEmails,
          today: emailsToday,
          yesterday: emailsYesterday,
          last7d: emailsLast7d,
          last30d: emailsLast30d,
          sent: sentCount,
          failed: failedCount,
          deliveryRate,
          uniqueRecipients: uniqueRecipientCount,
          dayOverDayChange,
        },
        bySender: senderBreakdown.map((s: any) => ({
          sender: s.sender,
          count: s._count,
        })),
        bySubject: subjectBreakdown.map((s: any) => ({
          subject: s.subject,
          count: s._count,
        })),
        daily: recentDaily,
        weeklyTrend: weeklyTrend,
        topRecipients: topRecipients.map((r: any) => ({
          recipient: r.recipient,
          count: r._count,
        })),
        hourlyDistribution: Object.entries(hourlyMap).map(([h, c]) => ({
          hour: parseInt(h),
          count: c,
        })),
        peakHour: { hour: parseInt(peakHour[0] as string), count: peakHour[1] as number },
        avgDailyVolume: avgDaily,
        failures: {
          total: failedCount,
          categories: errorCategories,
          topFailingRecipients: (topFailingRecipients as any[]).map((r) => ({
            recipient: r.recipient,
            failCount: r.fail_count,
            subjects: r.subjects,
          })),
          recent: recentFailed,
        },
      },
    });
  } catch (error: any) {
    logger.error("Admin Email Analytics Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
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
<<<<<<< HEAD
=======
 * @route   GET /api/admin/marketing/metrics
 * @desc    Get comprehensive marketing metrics for academic writing platform
 * @access  Admin Only
 */
router.get("/marketing/metrics", async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // User metrics
    const [
      totalUsers,
      newUsersLast30Days,
      activeUsersLast7Days,
      paidUsers,
      freeUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { created_at: { gte: thirtyDaysAgo } } }),
      prisma.user.count({ where: { last_seen_at: { gte: sevenDaysAgo } } }),
      prisma.subscription.count({ where: { status: "active" } }),
      prisma.user.count({
        where: {
          OR: [
            { subscription: null },
            { subscription: { status: { not: "active" } } },
          ],
        },
      }),
    ]);

    // Blog content metrics
    const [totalBlogs, publishedBlogs] = await Promise.all([
      prisma.blogPost.count(),
      prisma.blogPost.count({ where: { is_published: true } }),
    ]);

    // Support metrics
    const [openSupportTickets, resolvedToday] = await Promise.all([
      prisma.supportMessage.count({ where: { status: "open" } }),
      prisma.supportMessage.count({
        where: {
          status: "resolved",
          received_at: { gte: todayStart },
        },
      }),
    ]);

    // Academic platform metrics
    const [totalDocuments, citationsVerified, certificatesIssued, aiDetectionRuns] = await Promise.all([
      prisma.project.count(),
      prisma.citation.count(),
      prisma.certificate.count(),
      prisma.auditJob.count(),
    ]);

    // Email metrics
    const [emailsSentToday, totalEmailsSent, totalEmailsOpened] = await Promise.all([
      prisma.emailLog.count({
        where: {
          status: "sent",
          sent_at: { gte: todayStart },
        },
      }),
      prisma.emailLog.count({ where: { status: "sent" } }),
      prisma.emailLog.count({ where: { status: "opened" } }),
    ]);

    const emailOpenRate = totalEmailsSent > 0 ? Math.round((totalEmailsOpened / totalEmailsSent) * 100) : 0;

    // Referral metrics
    const [referralSignups] = await Promise.all([
      prisma.user.count({
        where: {
          referral_code: { not: null },
          created_at: { gte: thirtyDaysAgo },
        },
      }),
    ]);

    const referralConversionRate = totalUsers > 0 ? Math.round((referralSignups / totalUsers) * 100) : 0;

    res.json({
      success: true,
      data: {
        totalUsers,
        newUsersLast30Days,
        activeUsersLast7Days,
        paidUsers,
        freeUsers,
        totalBlogs,
        publishedBlogs,
        openSupportTickets,
        resolvedToday,
        totalDocuments,
        citationsVerified,
        certificatesIssued,
        aiDetectionRuns,
        emailsSentToday,
        emailOpenRate,
        referralSignups,
        referralConversionRate,
      },
    });
  } catch (error: any) {
    logger.error("Admin Marketing Metrics Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * @route   GET /api/admin/dashboard/metrics
 * @desc    Get main dashboard metrics for academic writing platform
 * @access  Admin Only
 */
router.get("/dashboard/metrics", async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // User metrics
    const [totalUsers, newUsersLast30Days, paidUsers] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { created_at: { gte: thirtyDaysAgo } } }),
      prisma.subscription.count({ where: { status: "active" } }),
    ]);

    // Online users (real-time presence)
    const activeUsersNow = await prisma.user.count({
      where: { online_status: true },
    });

    // Academic platform metrics
    const [totalDocuments, citationsVerified, certificatesIssued, aiDetectionRuns] = await Promise.all([
      prisma.project.count(),
      prisma.citation.count(),
      prisma.certificate.count(),
      prisma.auditJob.count(),
    ]);

    // Support tickets
    const openSupportTickets = await prisma.supportMessage.count({
      where: { status: "open" },
    });

    // Revenue (MRR from active subscriptions)
    const revenueData = await prisma.subscription.aggregate({
      _sum: { amount_cents: true },
      where: { status: "active" },
    });
    const mrr = (revenueData._sum.amount_cents ?? 0) / 100;

    res.json({
      success: true,
      data: {
        totalUsers,
        newUsersLast30Days,
        activeUsersNow,
        paidUsers,
        totalDocuments,
        citationsVerified,
        certificatesIssued,
        aiDetectionRuns,
        openSupportTickets,
        systemHealth: "Operational",
        mrr,
      },
    });
  } catch (error: any) {
    logger.error("Admin Dashboard Metrics Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
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

    const ADMIN_WHITELIST = ["simbisai@colabwize.com", "craig@colabwize.com", "craign@colabwize.com"];

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
<<<<<<< HEAD
=======
        last_seen_at: true,
        online_status: true,
        email_verified: true,
        updated_at: true,
>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
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
<<<<<<< HEAD
=======
 * @route   GET /api/admin/users/:email/activity
 * @desc    Fetch all email logs sent to a user + support messages from them
 * @access  Admin Only
 */
router.get("/users/:email/activity", async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);

    const [emailLogs, supportMessages, user] = await Promise.all([
      prisma.emailLog.findMany({
        where: { recipient: email },
        orderBy: { sent_at: "desc" },
        take: 100,
        select: {
          id: true,
          sender: true,
          subject: true,
          status: true,
          sent_at: true,
          error: true,
          message_body: true,
        },
      }),
      prisma.supportMessage.findMany({
        where: { sender_email: email },
        orderBy: { received_at: "desc" },
        take: 100,
        select: {
          id: true,
          subject: true,
          message_text: true,
          message_html: true,
          received_at: true,
          status: true,
          thread_id: true,
          source_alias: true,
          is_read: true,
        },
      }),
      prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          full_name: true,
          created_at: true,
          last_seen_at: true,
          online_status: true,
          email_verified: true,
          subscription: {
            select: { plan: true, status: true }
          },
        },
      }),
    ]);

    res.json({
      success: true,
      user,
      emailLogs,
      supportMessages,
    });
  } catch (error: any) {
    logger.error("Admin User Activity Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
 * @route   GET /api/admin/blogs
 * @desc    Fetch all blog posts
 * @access  Admin Only
 */
router.get("/blogs", async (req, res) => {
  try {
<<<<<<< HEAD
    const blogs = await prisma.blogPost.findMany({
=======
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const blogs = await prisma.blogPost.findMany({
      take: limit,
>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
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
    const { title, excerpt, content, author, category, image, is_published } = req.body;

    if (!title || !excerpt || !content || !author || !category) {
      return res.status(400).json({ error: "Missing required fields" });
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
<<<<<<< HEAD
        author_id: (req as any).user?.id // Assuming user ID is attached by middleware
      }
    });

=======
        author_id: (req as any).adminUser?.userId || (req as any).user?.id
      }
    });

    await createAuditLog({
      action: "BLOG_CREATED",
      adminEmail: getAdminEmail(req),
      entityType: "BlogPost",
      entityId: blog.id,
      metadata: { title },
      ...extractAuditContext(req),
    });

>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
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
    const updateData = req.body;

    if (updateData.title) {
      updateData.slug = updateData.title.toLowerCase().replace(/ /g, "-").replace(/[^\w-]+/g, "");
    }

    const blog = await prisma.blogPost.update({
      where: { id },
      data: updateData
    });

<<<<<<< HEAD
=======
    await createAuditLog({
      action: "BLOG_UPDATED",
      adminEmail: getAdminEmail(req),
      entityType: "BlogPost",
      entityId: id,
      metadata: { title: updateData.title },
      ...extractAuditContext(req),
    });

>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
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

<<<<<<< HEAD
=======
    await createAuditLog({
      action: "BLOG_DELETED",
      adminEmail: getAdminEmail(req),
      entityType: "BlogPost",
      entityId: id,
      ...extractAuditContext(req),
    });

>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
    res.json({ success: true });
  } catch (error: any) {
    logger.error("Admin Blog Delete Error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

<<<<<<< HEAD
=======
// Google Analytics 4 & Third-party Integrations
// integrationsRouter must come first so GA4 routes are matched before analyticsRouter
router.use("/analytics", integrationsRouter);
router.use("/analytics", analyticsRouter);

>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
export default router;
