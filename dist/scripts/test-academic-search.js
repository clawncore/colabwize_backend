"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const academicDatabaseService_1 = require("../services/academicDatabaseService");
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
// Load environment variables
const envPath = path_1.default.resolve(__dirname, "../../.env");
dotenv_1.default.config({ path: envPath });
const LOG_FILE = path_1.default.resolve(__dirname, "../../test-results.txt");
function log(msg) {
    console.log(msg);
    fs_1.default.appendFileSync(LOG_FILE, msg + "\n");
}
async function runTest() {
    // Clear log file
    fs_1.default.writeFileSync(LOG_FILE, "");
    // Test 1: Minimal author-year (FAILS)
    await runSingleTest("Stuart Russell et al., 1995");
    // Test 2: Full citation with title (SHOULD WORK)
    await runSingleTest('Lee, Kevin, Maria Gonzalez, and Ahmed Khan. "Deep Learning in Radiology." Journal of Medical Imaging 12, no. 4 (2020): 233–247');
    // Test 3: Just title + author + year (SHOULD WORK)
    await runSingleTest("Deep Learning in Radiology Lee 2020");
    process.exit(0); // Force exit to stop hanging
}
async function runSingleTest(query) {
    log("\n" + "=".repeat(60));
    log(`Test Query: "${query}"`);
    log("=".repeat(60));
    try {
        log("Starting search via AcademicDatabaseService...");
        const results = await academicDatabaseService_1.AcademicDatabaseService.searchAcademicDatabases(query);
        log("---------------------------------------------------");
        log(`Found ${results.length} results:`);
        if (results.length === 0) {
            log("No results found. Verification would FAIL.");
        }
        else {
            results.forEach((res, i) => {
                log(`\n[${i + 1}] Source: ${res.database.toUpperCase()}`);
                log(`    Title: ${res.title}`);
                log(`    Year: ${res.year || "N/A"}`);
                log(`    URL: ${res.url}`);
                log(`    Similarity Score: ${(res.similarity * 100).toFixed(1)}%`);
            });
        }
        log("---------------------------------------------------");
    }
    catch (error) {
        log("Test Failed with Error: " + error);
    }
}
runTest();
