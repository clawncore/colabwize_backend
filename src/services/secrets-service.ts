import logger from "../monitoring/logger";
import { prisma } from "../lib/prisma";

// Service to retrieve secrets from environment variables and Supabase Vault
export class SecretsService {
  // Get a secret value by name
  static async getSecret(name: string): Promise<string | null> {
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
        // We use queryRawUnsafe because key mapping might vary or we want simple array
        const result = (await prisma.$queryRawUnsafe(
          `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1`,
          name
        )) as any[];

        if (result && result.length > 0 && result[0].decrypted_secret) {
          logger.debug(`Retrieved secret ${name} from Supabase Vault`);
          return result[0].decrypted_secret;
        }
      } catch (dbError: any) {
        // Suppress DB errors but log debug info
        logger.debug(`Failed to fetch ${name} from Vault:`, dbError);
      }

      // If not found in environment, log warning
      logger.warn(`Secret ${name} not found in environment or Supabase Vault`);

      return null;
    } catch (error) {
      logger.error(`Error retrieving secret ${name}:`, error);
      return null;
    }
  }

  // Get OpenAI API key
  static async getOpenAiApiKey(): Promise<string | null> {
    const apiKey = await this.getSecret("OPENAI_API_KEY");
    if (!apiKey) {
      logger.error("OPENAI_API_KEY not configured - AI features will not work");
    }
    return apiKey;
  }

  // Get Resend API key
  static async getResendApiKey(): Promise<string | null> {
    const apiKey = await this.getSecret("RESEND_API_KEY");
    if (!apiKey) {
      logger.error(
        "RESEND_API_KEY not configured - email sending will not work"
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
    const url =
      (await this.getSecret("NEXT_PUBLIC_SUPABASE_URL")) ||
      (await this.getSecret("SUPABASE_URL"));
    const anonKey =
      (await this.getSecret("NEXT_PUBLIC_SUPABASE_ANON_KEY")) ||
      (await this.getSecret("SUPABASE_ANON_KEY"));
    const serviceRoleKey =
      (await this.getSecret("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")) ||
      (await this.getSecret("SUPABASE_SERVICE_ROLE_KEY"));

    if (!url || !anonKey) {
      logger.error(
        "Supabase configuration not fully set - database operations will fail"
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
      "COMPLIANCE_ADDITIONAL_EMAILS"
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
    studentProMonthlyVariantId: string | null;
    studentProAnnualVariantId: string | null;
    researcherMonthlyVariantId: string | null;
    researcherAnnualVariantId: string | null;
    onetimeVariantId: string | null;
    institutionalVariantId: string | null;
    credits10VariantId: string | null;
    credits25VariantId: string | null;
    credits50VariantId: string | null;
  }> {
    const config = {
      storeId: await this.getSecret("LEMONSQUEEZY_STORE_ID"),
      webhookSecret: await this.getSecret("LEMONSQUEEZY_WEBHOOK_SECRET"),
      studentProMonthlyVariantId: await this.getSecret(
        "LEMONSQUEEZY_STUDENT_PRO_MONTHLY_VARIANT_ID"
      ),
      studentProAnnualVariantId: await this.getSecret(
        "LEMONSQUEEZY_STUDENT_PRO_ANNUAL_VARIANT_ID"
      ),
      researcherMonthlyVariantId: await this.getSecret(
        "LEMONSQUEEZY_RESEARCHER_MONTHLY_VARIANT_ID"
      ),
      researcherAnnualVariantId: await this.getSecret(
        "LEMONSQUEEZY_RESEARCHER_ANNUAL_VARIANT_ID"
      ),
      onetimeVariantId: await this.getSecret("LEMONSQUEEZY_ONETIME_VARIANT_ID"),
      institutionalVariantId: await this.getSecret(
        "LEMONSQUEEZY_INSTITUTIONAL_VARIANT_ID"
      ),
      credits10VariantId: await this.getSecret(
        "LEMONSQUEEZY_CREDITS_10_VARIANT_ID"
      ),
      credits25VariantId: await this.getSecret(
        "LEMONSQUEEZY_CREDITS_25_VARIANT_ID"
      ),
      credits50VariantId: await this.getSecret(
        "LEMONSQUEEZY_CREDITS_50_VARIANT_ID"
      ),
    };

    if (!config.storeId || !config.webhookSecret) {
      logger.error(
        "LemonSqueezy configuration not fully set - billing features will fail"
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
    return this.getSecret("NEXT_PUBLIC_SUPABASE_URL");
  }

  static async getPublicSupabaseUrl(): Promise<string | null> {
    return this.getSecret("NEXT_PUBLIC_SUPABASE_URL");
  }

  static async getSupabaseAnonKey(): Promise<string | null> {
    return this.getSecret("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  static async getPublicSupabaseAnonKey(): Promise<string | null> {
    return this.getSecret("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  static async getSupabaseServiceRoleKey(): Promise<string | null> {
    return (
      (await this.getSecret("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")) ||
      (await this.getSecret("SUPABASE_SERVICE_ROLE_KEY"))
    );
  }

  // Get database configuration values
  static async getDatabaseUrl(): Promise<string | null> {
    return this.getSecret("DATABASE_URL");
  }

  // Get AI Detection configuration values
  static async getGptzeroApiKey(): Promise<string | null> {
    return this.getSecret("GPTZERO_API_KEY");
  }

  static async getOriginalityApiKey(): Promise<string | null> {
    return this.getSecret("ORIGINALITY_API_KEY");
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
}

export default SecretsService;
