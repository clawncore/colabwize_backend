
import { AcademicDatabaseService } from "../services/academicDatabaseService";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";

// Load environment variables
const envPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: envPath });

const LOG_FILE = path.resolve(__dirname, "../../test-results.txt");

function log(msg: string) {
    console.log(msg);
    fs.appendFileSync(LOG_FILE, msg + "\n");
}

async function runTest() {
    // Clear log file
    fs.writeFileSync(LOG_FILE, "");

    // Test 1: Minimal author-year (FAILS)
    await runSingleTest("Stuart Russell et al., 1995");

    // Test 2: Full citation with title (SHOULD WORK)
    await runSingleTest('Lee, Kevin, Maria Gonzalez, and Ahmed Khan. "Deep Learning in Radiology." Journal of Medical Imaging 12, no. 4 (2020): 233–247');

    // Test 3: Just title + author + year (SHOULD WORK)
    await runSingleTest("Deep Learning in Radiology Lee 2020");

    process.exit(0); // Force exit to stop hanging
}

async function runSingleTest(query: string) {
    log("\n" + "=".repeat(60));
    log(`Test Query: "${query}"`);
    log("=".repeat(60));

    try {
        log("Starting search via AcademicDatabaseService...");
        const results = await AcademicDatabaseService.searchAcademicDatabases(query);

        log("---------------------------------------------------");
        log(`Found ${results.length} results:`);

        if (results.length === 0) {
            log("No results found. Verification would FAIL.");
        } else {
            results.forEach((res, i) => {
                log(`\n[${i + 1}] Source: ${res.database.toUpperCase()}`);
                log(`    Title: ${res.title}`);
                log(`    Year: ${res.year || "N/A"}`);
                log(`    URL: ${res.url}`);
                log(`    Similarity Score: ${(res.similarity * 100).toFixed(1)}%`);
            });
        }
        log("---------------------------------------------------");

    } catch (error) {
        log("Test Failed with Error: " + error);
    }
}

runTest();
