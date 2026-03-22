import axios from 'axios';
import { SecretsService } from '../services/secrets-service';

async function testConnectivity() {
    console.log("Starting connectivity test...");

    const supabaseUrl = await SecretsService.getSupabaseUrl() || process.env.SUPABASE_URL;
    const anonKey = await SecretsService.getSupabaseAnonKey() || process.env.SUPABASE_ANON_KEY;

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
    } catch (error: any) {
        console.error("Fetch Failed:", error.message);
        if (error.cause) console.error("Cause:", error.cause);
    }

    // Test 2: Axios (HTTP/HTTPS)
    console.log("\n--- Test 2: Axios ---");
    try {
        const start = Date.now();
        const res = await axios.get(`${supabaseUrl}/auth/v1/health`);
        console.log(`Axios Status: ${res.status}`);
        console.log(`Time: ${Date.now() - start}ms`);
    } catch (error: any) {
        console.error("Axios Failed:", error.message);
    }
}

testConnectivity();
