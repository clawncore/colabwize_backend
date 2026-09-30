import axios, { AxiosInstance } from "axios";
import logger from "../../monitoring/logger";
import { SecretsService } from "../secrets-service";

const EMAILOCTOPUS_API_BASE = "https://api.emailoctopus.com/v2";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Singleton EmailOctopus API client.
 * Lazy-initializes via SecretsService to retrieve the API key.
 * Returns null if credentials are not available — never throws.
 */
let client: AxiosInstance | null = null;
let apiKey: string | null = null;
let listId: string | null = null;

export interface EmailOctopusResult {
  success: boolean;
  data?: any;
  error?: Error;
}

/**
 * Initializes and returns the EmailOctopus API client.
 * The client is cached after first successful initialization.
 */
export async function getEmailOctopusClient(): Promise<AxiosInstance | null> {
  if (client) return client;

  apiKey = await SecretsService.getEmailOctopusApiKey();
  listId = await SecretsService.getEmailOctopusListId();

  if (!apiKey) {
    logger.warn(
      "EMAILOCTOPUS_API_KEY is not configured — marketing broadcasts via EmailOctopus will be disabled. " +
      "Transactional/auth emails continue via Resend unaffected.",
    );
    return null;
  }

  if (!listId) {
    logger.warn(
      "EMAILOCTOPUS_LIST_ID is not configured — subscriber management and broadcast routing will be disabled. " +
      "Transactional/auth emails continue via Resend unaffected.",
    );
  }

  client = axios.create({
    baseURL: EMAILOCTOPUS_API_BASE,
    timeout: 30000,
    headers: {
      "Content-Type": "application/json",
    },
  });

  // Attach API key as query param (EmailOctopus uses ?api_key= for every request)
  client.interceptors.request.use((config) => {
    config.params = { ...config.params, api_key: apiKey };
    return config;
  });

  logger.info("EmailOctopus client initialized successfully");
  return client;
}

/**
 * Returns the configured list ID. May be null if not yet configured.
 */
export function getEmailOctopusListId(): string | null {
  return listId;
}

/**
 * Returns the configured API key. May be null if not yet configured.
 */
export function getEmailOctopusApiKey(): string | null {
  return apiKey;
}

/**
 * Generic request wrapper with retry logic matching the Resend client pattern.
 */
export async function emailOctopusRequest<T = any>(
  method: "get" | "post" | "put" | "delete",
  path: string,
  data?: any,
): Promise<EmailOctopusResult> {
  const apiClient = await getEmailOctopusClient();

  if (!apiClient || !listId) {
    return {
      success: false,
      error: new Error("EmailOctopus client not initialized or list ID not configured"),
    };
  }

  let lastError: any = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await apiClient.request<T>({
        method,
        url: path,
        data: data ? JSON.stringify(data) : undefined,
      });

      return { success: true, data: response.data };
    } catch (error: any) {
      lastError = error;
      logger.warn(`EmailOctopus API attempt ${attempt} failed`, {
        errorType: error?.name || "APIError",
        status: error?.response?.status,
        path,
      });

      // Don't retry on 4xx (except 429) — these are permanent failures
      const status = error?.response?.status;
      if (status && status >= 400 && status < 500 && status !== 429) {
        break;
      }

      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
    }
  }

  return { success: false, error: lastError };
}

export { apiKey, listId };
