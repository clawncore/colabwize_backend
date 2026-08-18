import * as dotenv from "dotenv";
dotenv.config();
import { gaService } from "./src/services/admin/integrations/googleAnalyticsService";

async function main() {
  console.log("WATCHTEST PID", process.pid);
  console.log("ENV_GAC_SET:", !!process.env.GOOGLE_APPLICATION_CREDENTIALS);
  console.log("STATUS:", JSON.stringify(gaService.getStatus()));
  try {
    const rows = await gaService.getEvents();
    console.log("ROWS:", rows.rows?.length, rows.rows?.map((r: any) => r.dimensionValues[0].value));
  } catch (e: any) {
    console.log("WATCHTEST FAILED:", e.message);
  }
  process.exit(0);
}
setTimeout(main, 1500);
