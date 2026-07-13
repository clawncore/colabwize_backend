import { processIncomingSupportEmails } from "../src/services/email/inboxFetcher";
import * as dotenv from "dotenv";

dotenv.config();

console.log("--- Starting Manual IMAP Sync Test ---");
processIncomingSupportEmails()
  .then(() => {
    console.log("--- Manual IMAP Sync Test Finished ---");
    process.exit(0);
  })
  .catch((err) => {
    console.error("--- Manual IMAP Sync Test Failed ---", err);
    process.exit(1);
  });
