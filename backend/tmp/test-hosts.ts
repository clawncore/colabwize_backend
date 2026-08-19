import { ImapFlow } from "imapflow";
import * as dotenv from "dotenv";

dotenv.config();

const hosts = [
  { host: "imap.titan.email", port: 993, secure: true },
  { host: "imap.secureserver.net", port: 993, secure: true },
  { host: "outlook.office365.com", port: 993, secure: true },
  { host: "imap.secureserver.net", port: 143, secure: false }, // STARTTLS
];

const user = "clawncore@colabwize.com";
const pass = "Chiblack2005!";

async function testHosts() {
  for (const config of hosts) {
    console.log(`--- Testing ${config.host}:${config.port} (Secure: ${config.secure}) ---`);
    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user, pass },
      logger: false,
      tls: { rejectUnauthorized: false } // Be lenient for testing
    });

    try {
      await client.connect();
      console.log(`✅ SUCCESS: Connected to ${config.host}`);
      await client.logout();
      process.exit(0);
    } catch (err: any) {
      console.log(`❌ FAILED: ${config.host} - ${err.message}`);
    }
  }
  console.log("--- All tests failed ---");
  process.exit(1);
}

testHosts().catch(console.error);
