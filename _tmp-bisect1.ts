import * as dotenv from "dotenv";
dotenv.config();
import "./src/api/admin/index";
import { gaService } from "./src/services/admin/integrations/googleAnalyticsService";

async function main() {
  console.log("BISECT1 PID", process.pid);
  console.log("ENV_GAC_SET:", !!process.env.GOOGLE_APPLICATION_CREDENTIALS);
  console.log("STATUS:", JSON.stringify(gaService.getStatus()));
  try {
    const rows = await gaService.getEvents();
    console.log("ROWS:", rows.rows?.length, rows.rows?.map((r: any) => r.dimensionValues[0].value));
  } catch (e: any) {
    console.log("BISECT1 FAILED:", e.message);
  }
  process.exit(0);
}
main();
