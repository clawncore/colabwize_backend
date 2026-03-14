import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import { prisma } from '../../lib/prisma';
import logger from '../../monitoring/logger';
import { SENDER_IDENTITIES } from './emailConfig';

// Extract the mapped aliases for reverse lookup
const ALIAS_DOMAINS = Object.values(SENDER_IDENTITIES).map(identity => {
  const match = identity.match(/<(.+)>/);
  return match ? match[1].toLowerCase() : null;
}).filter(Boolean) as string[];

export class InboxFetcher {
  private client: ImapFlow;

  constructor() {
    this.client = new ImapFlow({
      host: process.env.IMAP_HOST || 'imap.titan.email',
      port: parseInt(process.env.IMAP_PORT || '993', 10),
      secure: true,
      auth: {
        user: process.env.IMAP_USER || '',
        pass: process.env.IMAP_PASSWORD || ''
      },
      logger: false // Set to true for deep debugging
    });
  }

  public async processUnreadEmails() {
    if (!process.env.IMAP_USER || !process.env.IMAP_PASSWORD) {
      logger.warn("Support Inbox IMAP credentials missing. Skipping fetch.");
      return;
    }

    try {
      await this.client.connect();
      
      // Select and lock the INBOX
      const lock = await this.client.getMailboxLock('INBOX');
      
      try {
        // Fetch all unseen messages
        for await (const message of this.client.fetch({ seen: false }, { uid: true, envelope: true, source: true })) {
          // Process individual message
          await this.parseAndStoreMessage(message);

          // Mark as processed (seen)
          await this.client.messageFlagsAdd({ uid: message.uid }, ['\\Seen']);
        }
      } finally {
        lock.release();
      }
    } catch (error) {
      logger.error("InboxFetcher encounter an error:", error);
    } finally {
      // Graceful logout strictly required to avoid connection pooling limits on Titan
      if (this.client.usable) {
         await this.client.logout();
      }
    }
  }

  private async parseAndStoreMessage(message: any) {
    try {
      // Ensure idempotency constraint manually before heavy parsing
      const exists = await prisma.supportMessage.findUnique({
        where: { imap_uid: message.uid }
      });

      if (exists) {
        return; 
      }

      // Parse full raw buffer into structured object using mailparser
      const parsed: ParsedMail = await simpleParser(message.source);

      const senderEmail = parsed.from?.value[0]?.address || 'unknown@domain.com';
      let subject = parsed.subject || 'No Subject';
      
      // Attempt to identify which alias this was delivered/forwarded to
      let sourceAlias = 'unknown';
      let toAddresses: string[] = [];
      if (parsed.to) {
        const toField = Array.isArray(parsed.to) ? parsed.to : [parsed.to];
        toAddresses = toField.flatMap(t => t.value.map(addr => addr.address?.toLowerCase() || ''));
      }

      const identifiedAlias = toAddresses.find(addr => ALIAS_DOMAINS.includes(addr));
      
      if (identifiedAlias) {
        // Reverse lookup the key (HELP, SUPPORT, etc.)
        const entries = Object.entries(SENDER_IDENTITIES);
        for (const [key, identity] of entries) {
           if (identity.toLowerCase().includes(identifiedAlias)) {
             sourceAlias = key;
             break;
           }
        }
      }

      // Extract raw body
      const messageHtml = parsed.html || parsed.textAsHtml || '';
      const messageText = parsed.text || '';

      // Threading logic
      let threadId = parsed.inReplyTo || parsed.messageId; 
      
      // Fallback pseudo-threading by exact subject stripped of Re: flags
      if (!threadId && subject.toLowerCase().startsWith('re:')) {
        const cleanSubject = subject.replace(/^(re:\s*)+/i, '').trim();
        const existingThread = await prisma.supportMessage.findFirst({
            where: { 
              sender_email: senderEmail,
              subject: { contains: cleanSubject } 
            },
            orderBy: { received_at: 'asc' }
        });
        if (existingThread && existingThread.thread_id) {
           threadId = existingThread.thread_id;
        }
      }

      // Final fallback -> assign new UUID if absolutely no threading context exists
      if (!threadId) {
          threadId = `local-thread-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      }

      await prisma.supportMessage.create({
        data: {
          sender_email: senderEmail,
          subject,
          message_text: messageText,
          message_html: messageHtml,
          received_at: parsed.date || new Date(),
          status: 'open',
          thread_id: threadId,
          source_alias: sourceAlias,
          imap_uid: message.uid
        }
      });

      logger.info(`Successfully stored new support message via IMAP`, { uid: message.uid, sender: senderEmail });

    } catch (parseError) {
       logger.error(`Error parsing message UID ${message.uid}`, parseError);
    }
  }
}

export const processIncomingSupportEmails = async () => {
   const fetcher = new InboxFetcher();
   await fetcher.processUnreadEmails();
};
