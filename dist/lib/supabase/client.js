"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupabaseUrl = getSupabaseUrl;
exports.getSupabaseAnonKey = getSupabaseAnonKey;
exports.getSupabaseServiceRoleKey = getSupabaseServiceRoleKey;
exports.getSupabaseClient = getSupabaseClient;
exports.getSupabaseAdminClient = getSupabaseAdminClient;
const supabase_js_1 = require("@supabase/supabase-js");
const secrets_service_1 = require("../../services/secrets-service");
// Supabase client configuration
let _supabaseUrl = null;
let _supabaseAnonKey = null;
let _supabaseServiceRoleKey = null;
let _configInitialized = false;
// Initialize the Supabase configuration asynchronously
async function initializeSupabaseConfig() {
    _supabaseUrl =
        (await secrets_service_1.SecretsService.getSupabaseUrl()) ||
            (await secrets_service_1.SecretsService.getPublicSupabaseUrl());
    _supabaseAnonKey =
        (await secrets_service_1.SecretsService.getSupabaseAnonKey()) ||
            (await secrets_service_1.SecretsService.getPublicSupabaseAnonKey());
    _supabaseServiceRoleKey = await secrets_service_1.SecretsService.getSupabaseServiceRoleKey();
    _configInitialized = true;
    console.log("Supabase configuration:", {
        supabaseUrl: _supabaseUrl ? "SET" : "MISSING",
        supabaseAnonKey: _supabaseAnonKey ? "SET" : "MISSING",
        supabaseServiceRoleKey: _supabaseServiceRoleKey ? "SET" : "MISSING",
    });
    if (!_supabaseUrl || !_supabaseAnonKey) {
        console.error("Missing Supabase environment variables");
    }
}
// Initialize the configuration
initializeSupabaseConfig();
// Function to ensure config is loaded
const waitForConfig = async () => {
    // Since SecretsService now uses process.env directly, this should be instant.
    // We keep a simple check just in case of race conditions with module loading.
    if (_configInitialized)
        return;
    // Simple quick check
    if (!_supabaseUrl && process.env.SUPABASE_URL)
        _supabaseUrl = process.env.SUPABASE_URL;
    if (!_supabaseAnonKey && process.env.SUPABASE_ANON_KEY)
        _supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    if (!_supabaseServiceRoleKey && process.env.SUPABASE_SERVICE_ROLE_KEY)
        _supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    _configInitialized = true;
};
// Function to get the Supabase URL
async function getSupabaseUrl() {
    if (!_supabaseUrl)
        await waitForConfig();
    if (!_supabaseUrl) {
        if (process.env.SUPABASE_URL)
            return process.env.SUPABASE_URL;
        throw new Error("Supabase URL not configured");
    }
    return _supabaseUrl;
}
// Function to get the Supabase Anon Key
async function getSupabaseAnonKey() {
    await waitForConfig();
    if (!_supabaseAnonKey) {
        throw new Error("Supabase Anon Key not configured");
    }
    return _supabaseAnonKey;
}
// Function to get the Supabase Service Role Key
async function getSupabaseServiceRoleKey() {
    await waitForConfig();
    // Double check
    if (!_supabaseServiceRoleKey && process.env.SUPABASE_SERVICE_ROLE_KEY)
        _supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    return _supabaseServiceRoleKey;
}
// Function to get the Supabase client (with async initialization)
async function getSupabaseClient() {
    const url = await getSupabaseUrl();
    const anonKey = await getSupabaseAnonKey();
    return (0, supabase_js_1.createClient)(url, anonKey, {
        auth: {
            // Enable automatic token refresh
            autoRefreshToken: true,
            // Persist session in local storage
            persistSession: true,
            // Detect session changes
            detectSessionInUrl: true,
        },
    });
}
// Function to get the Supabase admin client (with async initialization)
async function getSupabaseAdminClient() {
    const url = await getSupabaseUrl();
    const serviceRoleKey = await getSupabaseServiceRoleKey();
    if (!serviceRoleKey) {
        console.warn("Supabase Service Role Key not configured");
        return null;
    }
    return (0, supabase_js_1.createClient)(url, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}
console.log("Supabase client getter functions exported");
