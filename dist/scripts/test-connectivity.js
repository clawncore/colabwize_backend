"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const secrets_service_1 = require("../services/secrets-service");
async function testConnectivity() {
    console.log("Starting connectivity test...");
    const supabaseUrl = await secrets_service_1.SecretsService.getSupabaseUrl() || process.env.SUPABASE_URL;
    const anonKey = await secrets_service_1.SecretsService.getSupabaseAnonKey() || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
        console.error("Missing Supabase credentials");
        return;
    }
    console.log(`Target URL: ${supabaseUrl}`);
    // Test 1: Native Fetch (Undici)
    console.log("\n--- Test 1: Native Fetch (Undici) ---");
    try {
        const start = Date.now();
        const res = await fetch(`${supabaseUrl}/auth/v1/health`);
        console.log(`Fetch Status: ${res.status}`);
        console.log(`Time: ${Date.now() - start}ms`);
    }
    catch (error) {
        console.error("Fetch Failed:", error.message);
        if (error.cause)
            console.error("Cause:", error.cause);
    }
    // Test 2: Axios (HTTP/HTTPS)
    console.log("\n--- Test 2: Axios ---");
    try {
        const start = Date.now();
        const res = await axios_1.default.get(`${supabaseUrl}/auth/v1/health`);
        console.log(`Axios Status: ${res.status}`);
        console.log(`Time: ${Date.now() - start}ms`);
    }
    catch (error) {
        console.error("Axios Failed:", error.message);
    }
}
testConnectivity();
