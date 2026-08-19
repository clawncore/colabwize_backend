import { processIncomingSupportEmails } from '../services/email/inboxFetcher';
import logger from '../monitoring/logger';

let checkInterval: NodeJS.Timeout;

export const scheduleInboxWorkerTask = () => {
  // Prevent duplicate execution intervals if called multiple times natively
  if (checkInterval) return;

  // Initial immediate run
  setTimeout(() => {
    executeTask();
  }, 5000); // 5 second startup delay for DB to warm up

  // 60-second polling interval
  checkInterval = setInterval(async () => {
    await executeTask();
  }, 1000 * 60);

  logger.info("Inbox Worker task scheduled to run every 60 seconds.");
};

const executeTask = async () => {
  try {
    await processIncomingSupportEmails();
  } catch (error) {
    logger.error("Failed to execute background Support Inbox worker task", error);
  }
};
