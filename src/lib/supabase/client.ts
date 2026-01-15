import { createClient } from "@supabase/supabase-js";
import { SecretsService } from "../../services/secrets-service";

// Supabase client configuration
let _supabaseUrl: string | null = null;
let _supabaseAnonKey: string | null = null;
let _supabaseServiceRoleKey: string | null = null;
let _configInitialized = false;

// Initialize the Supabase configuration asynchronously
async function initializeSupabaseConfig() {
  _supabaseUrl =
    (await SecretsService.getSupabaseUrl()) ||
    (await SecretsService.getPublicSupabaseUrl());
  _supabaseAnonKey =
    (await SecretsService.getSupabaseAnonKey()) ||
    (await SecretsService.getPublicSupabaseAnonKey());
  _supabaseServiceRoleKey = await SecretsService.getSupabaseServiceRoleKey();

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

// Function to get the Supabase URL
export async function getSupabaseUrl(): Promise<string> {
  if (!_configInitialized) {
    await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay to allow initialization
  }
  if (!_supabaseUrl) {
    throw new Error("Supabase URL not configured");
  }
  return _supabaseUrl;
}

// Function to get the Supabase Anon Key
export async function getSupabaseAnonKey(): Promise<string> {
  if (!_configInitialized) {
    await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay to allow initialization
  }
  if (!_supabaseAnonKey) {
    throw new Error("Supabase Anon Key not configured");
  }
  return _supabaseAnonKey;
}

// Function to get the Supabase Service Role Key
export async function getSupabaseServiceRoleKey(): Promise<string | null> {
  if (!_configInitialized) {
    await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay to allow initialization
  }
  return _supabaseServiceRoleKey;
}

// Function to get the Supabase client (with async initialization)
export async function getSupabaseClient() {
  const url = await getSupabaseUrl();
  const anonKey = await getSupabaseAnonKey();

  return createClient(url, anonKey, {
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
export async function getSupabaseAdminClient() {
  const url = await getSupabaseUrl();
  const serviceRoleKey = await getSupabaseServiceRoleKey();

  if (!serviceRoleKey) {
    console.warn("Supabase Service Role Key not configured");
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

console.log("Supabase client getter functions exported");

// Types for our database tables
export type User = {
  id: string;
  email: string;
  full_name?: string;
  phone_number?: string;
  otp_method?: string;
  user_type?: string;
  field_of_study?: string;
  selected_plan?: string;
  retention_period?: number;
  affiliate_ref?: string; // Add affiliate reference field
  created_at: string;
  updated_at: string;
};

export type Project = {
  id: string;
  user_id: string;
  title: string;
  type: string;
  citation_style: string;
  content: any;
  word_count: number;
  due_date?: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ProjectCollaborator = {
  id: string;
  project_id: string;
  user_id: string;
  permission: string;
  created_at: string;
};

export type Citation = {
  id: string;
  project_id: string;
  type: string;
  title: string;
  authors: any;
  year?: number;
  doi?: string;
  url?: string;
  metadata: any;
  created_at: string;
};

export type PlagiarismReport = {
  id: string;
  project_id: string;
  user_id: string;
  originality_score: number;
  matches: any;
  report_url?: string;
  created_at: string;
};

export type PlagiarismSettings = {
  id: string;
  user_id: string;
  sensitivity: string;
  exclude_quotes: boolean;
  exclude_bibliography: boolean;
  exclude_common_phrases: boolean;
  exclude_technical_terms: boolean;
  exclude_code: boolean;
  exclude_formulas: boolean;
  auto_check_before_export: boolean;
  show_matches_in_editor: boolean;
  email_on_complete: boolean;
  custom_sources: string[];
  created_at: string;
  updated_at: string;
};

export type AIUsage = {
  id: string;
  user_id: string;
  feature: string;
  tokens_used: number;
  cost: number;
  created_at: string;
};

export type Subscription = {
  id: string;
  user_id: string;
  plan: string;
  status: string;
  lemonsqueezy_subscription_id?: string;
  current_period_end?: string;
  created_at: string;
  updated_at: string;
};

export type OTPCode = {
  id: string;
  user_id: string;
  otp_code: string;
  method: string;
  expires_at: string;
  created_at: string;
};
