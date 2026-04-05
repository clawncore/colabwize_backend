import { GoogleDriveService } from "./src/services/googleDriveService";
import * as dotenv from "dotenv";
dotenv.config();

const run = async () => {
  try {
    const userId = "41083c9a-ad01-411e-8883-12e23432e8f7";
    const files = await GoogleDriveService.listFiles(userId);
    console.log("Success! Found", files.length);
  } catch (e: any) {
    console.error("Error calling GoogleDriveService:", e.message);
  }
}
run();
