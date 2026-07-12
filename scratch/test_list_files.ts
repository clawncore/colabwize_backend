import { GoogleDriveService } from "../src/services/googleDriveService";

async function main() {
  const userId = "baeff593-d3ce-4d09-ba45-6609007ecb8d";
  try {
    console.log("Calling GoogleDriveService.listFiles for", userId);
    const files = await GoogleDriveService.listFiles(userId);
    console.log("Success! Files found:", files.length);
  } catch (error: any) {
    console.error("Failed to list files. Error details:");
    console.error("Message:", error.message);
    console.error("Stack:", error.stack);
    console.error("Full error object:", JSON.stringify(error, null, 2));
  }
}

main();
