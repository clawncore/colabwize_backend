import * as dotenv from "dotenv";
dotenv.config();
import { gaService } from "./src/services/admin/integrations/googleAnalyticsService";

async function main() {
  const status = gaService.getStatus();
  console.log("STATUS:", JSON.stringify(status));
  console.log("ENV_GAC:", JSON.stringify(process.env.GOOGLE_APPLICATION_CREDENTIALS || "(unset)"));
  console.log("ENV_PID:", JSON.stringify(process.env.GOOGLE_ANALYTICS_PROPERTY_ID || "(unset)"));
  try {
    const rows = await gaService.getEvents();
    console.log("ROWS:", rows.rows?.length, rows.rows?.map((r: any) => r.dimensionValues[0].value));
  } catch (e: any) {
    console.log("PROBE FAILED:", e.message);
  }
}
main();
