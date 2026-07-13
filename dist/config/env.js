"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.validateEnv = validateEnv;
// Environment configuration
const secrets_service_1 = require("../services/secrets-service");
exports.config = {
    // Supabase configuration
    supabase: {
        url: null,
        anonKey: null,
        serviceRoleKey: null,
    },
    // LemonSqueezy for payments
    lemonsqueezy: {
        apiKey: null,
        storeId: null,
        webhookSecret: null,
    },
    // OpenAI configuration
    openai: {
        apiKey: null,
    },
    // Application settings
    app: {
        url: "http://localhost:3000",
        environment: "development",
    },
};
// Initialize the config with async values
async function initializeConfig() {
    // Supabase configuration
    exports.config.supabase.url =
        (await secrets_service_1.SecretsService.getSupabaseUrl()) ||
            (await secrets_service_1.SecretsService.getPublicSupabaseUrl());
    exports.config.supabase.anonKey =
        (await secrets_service_1.SecretsService.getSupabaseAnonKey()) ||
            (await secrets_service_1.SecretsService.getPublicSupabaseAnonKey());
    exports.config.supabase.serviceRoleKey =
        await secrets_service_1.SecretsService.getSupabaseServiceRoleKey();
    // LemonSqueezy for payments
    exports.config.lemonsqueezy.apiKey = await secrets_service_1.SecretsService.getLemonsqueezyApiKey();
    exports.config.lemonsqueezy.storeId = await secrets_service_1.SecretsService.getLemonsqueezyStoreId();
    exports.config.lemonsqueezy.webhookSecret =
        await secrets_service_1.SecretsService.getLemonsqueezyWebhookSecret();
    // OpenAI configuration
    exports.config.openai.apiKey = await secrets_service_1.SecretsService.getOpenAiApiKey();
    // Application settings
    exports.config.app.url =
        (await secrets_service_1.SecretsService.getAppUrl()) ||
            (await secrets_service_1.SecretsService.getPublicAppUrl()) ||
            "http://localhost:3000";
    exports.config.app.environment = await secrets_service_1.SecretsService.getNodeEnv();
    console.log("Environment configuration loaded:");
    console.log("LemonSqueezy config:", {
        hasApiKey: !!exports.config.lemonsqueezy.apiKey,
        hasStoreId: !!exports.config.lemonsqueezy.storeId,
        hasWebhookSecret: !!exports.config.lemonsqueezy.webhookSecret,
        apiKeyLength: exports.config.lemonsqueezy.apiKey?.length,
        storeId: exports.config.lemonsqueezy.storeId,
        webhookSecret: exports.config.lemonsqueezy.webhookSecret ? "SET" : "NOT_SET",
    });
}
// Initialize the configuration
initializeConfig();
// Validate required environment variables
async function validateEnv() {
    const required = [];
    // Check for Supabase credentials
    const supabaseUrl = await secrets_service_1.SecretsService.getSupabaseUrl();
    const supabaseAnonKey = await secrets_service_1.SecretsService.getSupabaseAnonKey();
    const hasSupabase = supabaseUrl && supabaseAnonKey;
    // Check for database connection
    const databaseUrl = await secrets_service_1.SecretsService.getDatabaseUrl();
    const hasDatabase = databaseUrl;
    if (!hasSupabase) {
        required.push("SUPABASE_URL and SUPABASE_ANON_KEY");
    }
    if (!hasDatabase) {
        required.push("DATABASE_URL");
    }
    if (required.length > 0) {
        throw new Error(`Missing required environment variables: ${required.join(", ")}`);
    }
    console.log("✅ Using Supabase Authentication");
}
