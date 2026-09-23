import logger from "../monitoring/logger";
import { initializePrisma } from "../lib/prisma-async";

// Service to retrieve secrets from environment variables and Supabase Vault
export class SecretsService {
  // Get a secret value by name
  static async getSecret(name: string): Promise<string | null> {
    try {
      // 1. Try environment variables (highest priority for local overrides)
      const envValue = process.env[name];
      if (envValue) {
        return envValue;
      }

      // 2. Try Supabase Vault via Database
      // Note: This requires DATABASE_URL to be set in environment
      // F-31: Explicitly parameterized via Prisma $queryRaw template literal.
      // Prisma binds `${name}` as a bound parameter (NOT string interpolation),
      // making this safe from SQL injection. Do not convert to $queryRawUnsafe.
      try {
        const prismaClient = await initializePrisma();
        const result = (await prismaClient.$queryRaw`
          SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ${name} LIMIT 1
        `) as any[];

        if (result && result.length > 0 && result[0].decrypted_secret) {
          logger.debug("Retrieved secret from Supabase Vault", { secretCategory: name.replace(/_KEY$/, "_KEY_[REDACTED]") });
          return result[0].decrypted_secret;
        }
      } catch (dbError: any) {
        logger.debug("Failed to fetch secret from Vault", { secretCategory: name.replace(/_KEY$/, "_KEY_[REDACTED]") });
      }

      if (!envValue) {
        logger.warn("Secret not found in environment or Supabase Vault", { secretCategory: name.replace(/_KEY$/, "_KEY_[REDACTED]") });
      }

      return null;
    } catch (error) {
      logger.error("Error retrieving secret", { secretCategory: name.replace(/_KEY$/, "_KEY_[REDACTED]") });
      return null;
    }
  }

  // Get OpenAI API key
  static async getOpenAiApiKey(): Promise<string | null> {
    const apiKey = await this.getSecret("OPENAI_API_KEY");
    if (!apiKey) {
      logger.error("API key not configured - AI features will not work", { keyCategory: "OPENAI_API_KEY_[REDACTED]" });
    }
    return apiKey;
  }

  // Get Resend API key
  static async getResendApiKey(): Promise<string | null> {
    const apiKey = await this.getSecret("RESEND_API_KEY");
    if (!apiKey) {
      logger.error(
        "API key not configured - email sending will not work",
        { keyCategory: "RESEND_API_KEY_[REDACTED]" },
      );
    }
    return apiKey;
  }

  // Get Supabase configuration
  static async getSupabaseConfig(): Promise<{
    url: string | null;
    anonKey: string | null;
    serviceRoleKey: string | null;
  }> {
    const url = await this.getSupabaseUrl();
    const anonKey = await this.getSupabaseAnonKey();
    const serviceRoleKey = await this.getSupabaseServiceRoleKey();

    if (!url || !anonKey) {
      logger.error(
        "Supabase configuration not fully set - database operations will fail",
        { missing: ["url", "anonKey"].filter((k) => !(k === "url" ? url : anonKey)) },
      );
    }

    return { url, anonKey, serviceRoleKey };
  }

  // Get Admin user IDs
  static async getAdminUserIds(): Promise<string[]> {
    const adminUserIdsStr = await this.getSecret("ADMIN_USER_IDS");
    return adminUserIdsStr ? adminUserIdsStr.split(",") : [];
  }

  // Get feedback email
  static async getFeedbackEmail(): Promise<string> {
    return (await this.getSecret("FEEDBACK_EMAIL")) || "feedback@colabwize.com";
  }

  // Get contact admin email
  static async getContactAdminEmail(): Promise<string> {
    return (
      (await this.getSecret("CONTACT_ADMIN_EMAIL")) || "hello@colabwize.com"
    );
  }

  // Get compliance email
  static async getComplianceEmail(): Promise<string> {
    return (
      (await this.getSecret("COMPLIANCE_EMAIL")) || "compliance@colabwize.com"
    );
  }

  // Get additional compliance emails
  static async getAdditionalComplianceEmails(): Promise<string[]> {
    const additionalEmailsStr = await this.getSecret(
      "COMPLIANCE_ADDITIONAL_EMAILS",
    );
    return additionalEmailsStr ? additionalEmailsStr.split(",") : [];
  }

  // Get frontend URL
  static async getFrontendUrl(): Promise<string> {
    return (await this.getSecret("FRONTEND_URL")) || "http://localhost:3000";
  }

  // Get backend URL
  static async getBackendUrl(): Promise<string> {
    return (await this.getSecret("BACKEND_URL")) || "http://localhost:3001";
  }

  // Get app URL
  static async getAppUrl(): Promise<string> {
    return (await this.getSecret("APP_URL")) || "http://localhost:3000";
  }

  // Get public app URL
  static async getPublicAppUrl(): Promise<string | null> {
    return await this.getSecret("NEXT_PUBLIC_APP_URL");
  }

  // Get Node environment
  static async getNodeEnv(): Promise<string> {
    return (await this.getSecret("NODE_ENV")) || "development";
  }

  // Get preferred AI provider
  static async getPreferredAiProvider(): Promise<string | null> {
    return await this.getSecret("PREFERRED_AI_PROVIDER");
  }

  // Get SerpAPI key
  static async getSerpApiKey(): Promise<string | null> {
    return await this.getSecret("SERPAPI_KEY");
  }

  // Get Google CSE ID
  static async getGoogleCseId(): Promise<string | null> {
    return await this.getSecret("GOOGLE_CSE_ID");
  }

  // Get Google API key
  static async getGoogleApiKey(): Promise<string | null> {
    return await this.getSecret("GOOGLE_API_KEY");
  }

  // Get LemonSqueezy configuration
  static async getLemonSqueezyConfig(): Promise<{
    storeId: string | null;
    webhookSecret: string | null;
    plusMonthlyVariantId: string | null;
    plusAnnualVariantId: string | null;
    premiumMonthlyVariantId: string | null;
    premiumAnnualVariantId: string | null;
    onetimeVariantId: string | null;
    institutionalVariantId: string | null;
    credits10VariantId: string | null;
    credits25VariantId: string | null;
    credits50VariantId: string | null;
  }> {
    const config = {
      storeId: await this.getSecret("LEMONSQUEEZY_STORE_ID"),
      webhookSecret: await this.getSecret("LEMONSQUEEZY_WEBHOOK_SECRET"),
      plusMonthlyVariantId: await this.getSecret(
        "LEMONSQUEEZY_PLUS_MONTHLY_VARIANT_ID",
      ),
      plusAnnualVariantId: await this.getSecret(
        "LEMONSQUEEZY_PLUS_ANNUAL_VARIANT_ID",
      ),
      premiumMonthlyVariantId: await this.getSecret(
        "LEMONSQUEEZY_PREMIUM_MONTHLY_VARIANT_ID",
      ),
      premiumAnnualVariantId: await this.getSecret(
        "LEMONSQUEEZY_PREMIUM_ANNUAL_VARIANT_ID",
      ),
      onetimeVariantId: await this.getSecret("LEMONSQUEEZY_ONETIME_VARIANT_ID"),
      institutionalVariantId: await this.getSecret(
        "LEMONSQUEEZY_INSTITUTIONAL_VARIANT_ID",
      ),
      credits10VariantId: await this.getSecret(
        "LEMONSQUEEZY_CREDITS_10_VARIANT_ID",
      ),
      credits25VariantId: await this.getSecret(
        "LEMONSQUEEZY_CREDITS_25_VARIANT_ID",
      ),
      credits50VariantId: await this.getSecret(
        "LEMONSQUEEZY_CREDITS_50_VARIANT_ID",
      ),
    };

    if (!config.storeId || !config.webhookSecret) {
      logger.error(
        "LemonSqueezy configuration not fully set - billing features will fail",
      );
    }

    return config;
  }

  // Get token encryption key
  static async getTokenEncryptionKey(): Promise<string> {
    return (await this.getSecret("TOKEN_ENCRYPTION_KEY")) || "";
  }

  // Get base URL
  static async getBaseUrl(): Promise<string> {
    return (await this.getSecret("BASE_URL")) || "http://localhost:3001";
  }

  // Get LemonSqueezy configuration values
  static async getLemonsqueezyApiKey(): Promise<string | null> {
    return this.getSecret("LEMONSQUEEZY_API_KEY");
  }

  static async getLemonsqueezyStoreId(): Promise<string | null> {
    return this.getSecret("LEMONSQUEEZY_STORE_ID");
  }

  static async getLemonsqueezyWebhookSecret(): Promise<string | null> {
    return this.getSecret("LEMONSQUEEZY_WEBHOOK_SECRET");
  }

  // Get Supabase configuration values
  static async getSupabaseUrl(): Promise<string | null> {
    // STRICT ENV ONLY - Bypass DB Vault to avoid circular dependency
    return (
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || null
    );
  }

  static async getPublicSupabaseUrl(): Promise<string | null> {
    return (
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || null
    );
  }

  static async getSupabaseAnonKey(): Promise<string | null> {
    // STRICT ENV ONLY - Bypass DB Vault to avoid circular dependency
    return (
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      null
    );
  }

  static async getPublicSupabaseAnonKey(): Promise<string | null> {
    return (
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      null
    );
  }

  static async getSupabaseServiceRoleKey(): Promise<string | null> {
    // STRICT ENV ONLY - Bypass DB Vault to avoid circular dependency.
    // CRITICAL: NEVER read a service-role key from a NEXT_PUBLIC_* variable.
    // Publicly-prefixed env vars are inlined into the browser bundle at build
    // time and must never hold a privileged key. If one is present, fail loudly
    // at startup so it cannot silently leak into client code.
    if (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "FATAL: NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY is set. A service-role key must never be prefixed with NEXT_PUBLIC — it would be shipped to browsers. Remove it from the public env and use SUPABASE_SERVICE_ROLE_KEY only.",
      );
    }
    return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
  }

  // Get database configuration values
  static async getDatabaseUrl(): Promise<string | null> {
    // CRITICAL: Strictly return from environment logic to avoid circular dependency.
    // SecretsService cannot query the DB to find the DB URL.
    return process.env.DATABASE_URL || null;
  }

  // Get AI Detection configuration values
  static async getCopyLeaksEmail(): Promise<string | null> {
    return this.getSecret("COPYLEAKS_EMAIL");
  }

  static async getCopyLeaksApiKey(): Promise<string | null> {
    return this.getSecret("COPYLEAKS_API_KEY");
  }

  // Get Copyscape configuration
  static async getCopyscapeUsername(): Promise<string | null> {
    return this.getSecret("COPYSCAPE_USERNAME");
  }

  static async getCopyscapeApiKey(): Promise<string | null> {
    return this.getSecret("COPYSCAPE_API_KEY");
  }

  // Get Anthropic API key
  static async getAnthropicApiKey(): Promise<string | null> {
    return this.getSecret("ANTHROPIC_API_KEY");
  }

  // Get Semantic Scholar API key
  static async getSemanticScholarApiKey(): Promise<string | null> {
    return this.getSecret("SEMANTIC_SCHOLAR_API_KEY");
  }

  // Get OpenAlex API key
  static async getOpenAlexApiKey(): Promise<string | null> {
    return this.getSecret("OPENALEX_API_KEY");
  }

  // Get allowed origins for CORS
  static async getAllowedOrigins(): Promise<string | null> {
    return this.getSecret("ALLOWED_ORIGINS");
  }

  // Get Discord webhook URLs
  static async getContactWebhookUrl(): Promise<string | null> {
    return this.getSecret("CONTACT_REQUEST_DISCORD_WEBHOOK_URL");
  }

  static async getDemoWebhookUrl(): Promise<string | null> {
    return this.getSecret("DEMO_REQUEST_DISCORD_WEBHOOK_URL");
  }

  static async getFeatureWebhookUrl(): Promise<string | null> {
    return this.getSecret("FEATURE_REQUEST_DISCORD_WEBHOOK_URL");
  }

  static async getSignupSurveyWebhookUrl(): Promise<string | null> {
    return this.getSecret("SIGNUP_SURVEY_DISCORD_WEBHOOK_URL");
  }

  // Get port configuration
  static async getPort(): Promise<number> {
    const port = await this.getSecret("PORT");
    return port ? parseInt(port, 10) : 3001;
  }

  // Get log level
  static async getLogLevel(): Promise<string> {
    return (await this.getSecret("LOG_LEVEL")) || "info";
  }

  // Get Google Custom Search configuration
  static async getGoogleCustomSearchApiKey(): Promise<string | null> {
    return this.getSecret("GOOGLE_CUSTOM_SEARCH_API_KEY");
  }

  static async getGoogleSearchEngineId(): Promise<string | null> {
    return this.getSecret("GOOGLE_SEARCH_ENGINE_ID");
  }

  // Get EmailOctopus configuration for marketing email provider
  static async getEmailOctopusApiKey(): Promise<string | null> {
    const apiKey = await this.getSecret("EMAILOCTOPUS_API_KEY");
    if (!apiKey) {
      logger.warn(
        "EMAILOCTOPUS_API_KEY is not configured — marketing broadcast via EmailOctopus is disabled. " +
        "Transactional and auth emails continue unaffected via Resend.",
      );
    }
    return apiKey;
  }

  static async getEmailOctopusListId(): Promise<string | null> {
    const listId = await this.getSecret("EMAILOCTOPUS_LIST_ID");
    if (!listId) {
      logger.warn(
        "EMAILOCTOPUS_LIST_ID is not configured — EmailOctopus audience management is disabled. " +
        "Transactional and auth emails continue unaffected via Resend.",
      );
    }
    return listId;
  }
}

export default SecretsService;
