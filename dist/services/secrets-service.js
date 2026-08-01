"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecretsService = void 0;
const logger_1 = __importDefault(require("../monitoring/logger"));
const prisma_async_1 = require("../lib/prisma-async");
// Service to retrieve secrets from environment variables and Supabase Vault
class SecretsService {
    // Get a secret value by name
    static async getSecret(name) {
        try {
            // 1. Try environment variables (highest priority for local overrides)
            const envValue = process.env[name];
            if (envValue) {
                // logger.debug(`Retrieved secret ${name} from environment variables`);
                return envValue;
            }
            // 2. Try Supabase Vault via Database
            // Note: This requires DATABASE_URL to be set in environment
            try {
                // Run raw query to fetch from vault.decrypted_secrets view
                const prismaClient = await (0, prisma_async_1.initializePrisma)();
                const result = (await prismaClient.$queryRaw `
          SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ${name} LIMIT 1
        `);
                if (result && result.length > 0 && result[0].decrypted_secret) {
                    logger_1.default.debug(`Retrieved secret ${name} from Supabase Vault`);
                    return result[0].decrypted_secret;
                }
            }
            catch (dbError) {
                // Suppress DB errors but log debug info
                logger_1.default.debug(`Failed to fetch ${name} from Vault:`, dbError);
            }
            // If not found in environment, log warning
            logger_1.default.warn(`Secret ${name} not found in environment or Supabase Vault`);
            return null;
        }
        catch (error) {
            logger_1.default.error(`Error retrieving secret ${name}:`, error);
            return null;
        }
    }
    // Get OpenAI API key
    static async getOpenAiApiKey() {
        const apiKey = await this.getSecret("OPENAI_API_KEY");
        if (!apiKey) {
            logger_1.default.error("OPENAI_API_KEY not configured - AI features will not work");
        }
        return apiKey;
    }
    // Get Resend API key
    static async getResendApiKey() {
        const apiKey = await this.getSecret("RESEND_API_KEY");
        if (!apiKey) {
            logger_1.default.error("RESEND_API_KEY not configured - email sending will not work");
        }
        return apiKey;
    }
    // Get Supabase configuration
    static async getSupabaseConfig() {
        const url = await this.getSupabaseUrl();
        const anonKey = await this.getSupabaseAnonKey();
        const serviceRoleKey = await this.getSupabaseServiceRoleKey();
        if (!url || !anonKey) {
            logger_1.default.error("Supabase configuration not fully set - database operations will fail");
        }
        return { url, anonKey, serviceRoleKey };
    }
    // Get Admin user IDs
    static async getAdminUserIds() {
        const adminUserIdsStr = await this.getSecret("ADMIN_USER_IDS");
        return adminUserIdsStr ? adminUserIdsStr.split(",") : [];
    }
    // Get feedback email
    static async getFeedbackEmail() {
        return (await this.getSecret("FEEDBACK_EMAIL")) || "feedback@colabwize.com";
    }
    // Get contact admin email
    static async getContactAdminEmail() {
        return ((await this.getSecret("CONTACT_ADMIN_EMAIL")) || "hello@colabwize.com");
    }
    // Get compliance email
    static async getComplianceEmail() {
        return ((await this.getSecret("COMPLIANCE_EMAIL")) || "compliance@colabwize.com");
    }
    // Get additional compliance emails
    static async getAdditionalComplianceEmails() {
        const additionalEmailsStr = await this.getSecret("COMPLIANCE_ADDITIONAL_EMAILS");
        return additionalEmailsStr ? additionalEmailsStr.split(",") : [];
    }
    // Get frontend URL
    static async getFrontendUrl() {
        return (await this.getSecret("FRONTEND_URL")) || "http://localhost:3000";
    }
    // Get backend URL
    static async getBackendUrl() {
        return (await this.getSecret("BACKEND_URL")) || "http://localhost:3001";
    }
    // Get app URL
    static async getAppUrl() {
        return (await this.getSecret("APP_URL")) || "http://localhost:3000";
    }
    // Get public app URL
    static async getPublicAppUrl() {
        return await this.getSecret("NEXT_PUBLIC_APP_URL");
    }
    // Get Node environment
    static async getNodeEnv() {
        return (await this.getSecret("NODE_ENV")) || "development";
    }
    // Get preferred AI provider
    static async getPreferredAiProvider() {
        return await this.getSecret("PREFERRED_AI_PROVIDER");
    }
    // Get SerpAPI key
    static async getSerpApiKey() {
        return await this.getSecret("SERPAPI_KEY");
    }
    // Get Google CSE ID
    static async getGoogleCseId() {
        return await this.getSecret("GOOGLE_CSE_ID");
    }
    // Get Google API key
    static async getGoogleApiKey() {
        return await this.getSecret("GOOGLE_API_KEY");
    }
    // Get LemonSqueezy configuration
    static async getLemonSqueezyConfig() {
        const config = {
            storeId: await this.getSecret("LEMONSQUEEZY_STORE_ID"),
            webhookSecret: await this.getSecret("LEMONSQUEEZY_WEBHOOK_SECRET"),
            plusMonthlyVariantId: await this.getSecret("LEMONSQUEEZY_PLUS_MONTHLY_VARIANT_ID"),
            plusAnnualVariantId: await this.getSecret("LEMONSQUEEZY_PLUS_ANNUAL_VARIANT_ID"),
            premiumMonthlyVariantId: await this.getSecret("LEMONSQUEEZY_PREMIUM_MONTHLY_VARIANT_ID"),
            premiumAnnualVariantId: await this.getSecret("LEMONSQUEEZY_PREMIUM_ANNUAL_VARIANT_ID"),
            onetimeVariantId: await this.getSecret("LEMONSQUEEZY_ONETIME_VARIANT_ID"),
            institutionalVariantId: await this.getSecret("LEMONSQUEEZY_INSTITUTIONAL_VARIANT_ID"),
            credits10VariantId: await this.getSecret("LEMONSQUEEZY_CREDITS_10_VARIANT_ID"),
            credits25VariantId: await this.getSecret("LEMONSQUEEZY_CREDITS_25_VARIANT_ID"),
            credits50VariantId: await this.getSecret("LEMONSQUEEZY_CREDITS_50_VARIANT_ID"),
        };
        if (!config.storeId || !config.webhookSecret) {
            logger_1.default.error("LemonSqueezy configuration not fully set - billing features will fail");
        }
        return config;
    }
    // Get token encryption key
    static async getTokenEncryptionKey() {
        return (await this.getSecret("TOKEN_ENCRYPTION_KEY")) || "";
    }
    // Get base URL
    static async getBaseUrl() {
        return (await this.getSecret("BASE_URL")) || "http://localhost:3001";
    }
    // Get LemonSqueezy configuration values
    static async getLemonsqueezyApiKey() {
        return this.getSecret("LEMONSQUEEZY_API_KEY");
    }
    static async getLemonsqueezyStoreId() {
        return this.getSecret("LEMONSQUEEZY_STORE_ID");
    }
    static async getLemonsqueezyWebhookSecret() {
        return this.getSecret("LEMONSQUEEZY_WEBHOOK_SECRET");
    }
    // Get Supabase configuration values
    static async getSupabaseUrl() {
        // STRICT ENV ONLY - Bypass DB Vault to avoid circular dependency
        return (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || null);
    }
    static async getPublicSupabaseUrl() {
        return (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || null);
    }
    static async getSupabaseAnonKey() {
        // STRICT ENV ONLY - Bypass DB Vault to avoid circular dependency
        return (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
            process.env.SUPABASE_ANON_KEY ||
            null);
    }
    static async getPublicSupabaseAnonKey() {
        return (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
            process.env.SUPABASE_ANON_KEY ||
            null);
    }
    static async getSupabaseServiceRoleKey() {
        // STRICT ENV ONLY - Bypass DB Vault to avoid circular dependency
        return (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY ||
            process.env.SUPABASE_SERVICE_ROLE_KEY ||
            null);
    }
    // Get database configuration values
    static async getDatabaseUrl() {
        // CRITICAL: Strictly return from environment logic to avoid circular dependency.
        // SecretsService cannot query the DB to find the DB URL.
        return process.env.DATABASE_URL || null;
    }
    // Get AI Detection configuration values
    static async getCopyLeaksEmail() {
        return this.getSecret("COPYLEAKS_EMAIL");
    }
    static async getCopyLeaksApiKey() {
        return this.getSecret("COPYLEAKS_API_KEY");
    }
    // Get Copyscape configuration
    static async getCopyscapeUsername() {
        return this.getSecret("COPYSCAPE_USERNAME");
    }
    static async getCopyscapeApiKey() {
        return this.getSecret("COPYSCAPE_API_KEY");
    }
    // Get Anthropic API key
    static async getAnthropicApiKey() {
        return this.getSecret("ANTHROPIC_API_KEY");
    }
    // Get Semantic Scholar API key
    static async getSemanticScholarApiKey() {
        return this.getSecret("SEMANTIC_SCHOLAR_API_KEY");
    }
    // Get OpenAlex API key
    static async getOpenAlexApiKey() {
        return this.getSecret("OPENALEX_API_KEY");
    }
    // Get allowed origins for CORS
    static async getAllowedOrigins() {
        return this.getSecret("ALLOWED_ORIGINS");
    }
    // Get Discord webhook URLs
    static async getContactWebhookUrl() {
        return this.getSecret("CONTACT_REQUEST_DISCORD_WEBHOOK_URL");
    }
    static async getDemoWebhookUrl() {
        return this.getSecret("DEMO_REQUEST_DISCORD_WEBHOOK_URL");
    }
    static async getFeatureWebhookUrl() {
        return this.getSecret("FEATURE_REQUEST_DISCORD_WEBHOOK_URL");
    }
    static async getSignupSurveyWebhookUrl() {
        return this.getSecret("SIGNUP_SURVEY_DISCORD_WEBHOOK_URL");
    }
    // Get port configuration
    static async getPort() {
        const port = await this.getSecret("PORT");
        return port ? parseInt(port, 10) : 3001;
    }
    // Get log level
    static async getLogLevel() {
        return (await this.getSecret("LOG_LEVEL")) || "info";
    }
    // Get Google Custom Search configuration
    static async getGoogleCustomSearchApiKey() {
        return this.getSecret("GOOGLE_CUSTOM_SEARCH_API_KEY");
    }
    static async getGoogleSearchEngineId() {
        return this.getSecret("GOOGLE_SEARCH_ENGINE_ID");
    }
}
exports.SecretsService = SecretsService;
exports.default = SecretsService;
