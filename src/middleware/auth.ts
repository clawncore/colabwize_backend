import { getSupabaseAdminClient, getSupabaseUrl, getSupabaseAnonKey } from "../lib/supabase/client";
import axios from "axios";
import {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
} from "express";

// STRICT AUTHENTICATION MIDDLEWARE
// Uses Supabase Service Role Key for authoritative verification.
// Removes local caching and "split-brain" verification strategies.

export async function authenticateRequest(
  request: Request
): Promise<{ user: any; session: any } | null> {
  try {
    const authHeader = request.headers.get("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }

    const token = authHeader.substring(7);

    // Strict Verification: Always use Service Role (Admin) Client
    const supabase = await getSupabaseAdminClient();
    if (!supabase) {
      console.error("Critical: Supabase Admin Client not available");
      return null;
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return null;
    }

    return {
      user: data.user,
      session: null, // Admin client does not return a session object
    };
  } catch (error) {
    console.error("Edge Auth Error:", error);
    return null;
  }
}

// Express Middleware
export async function authenticateExpressRequest(
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    let token = "";

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else if (req.query.token) {
      token = req.query.token as string;
    }

    if (!token) {
      res.status(401).json({
        success: false,
        message: "Missing or invalid authorization"
      });
      return;
    }

    const supabase = await getSupabaseAdminClient();
    if (!supabase) {
      console.error("Critical: Supabase Admin Client not available");
      res.status(500).json({
        success: false,
        message: "Authentication service unavailable"
      });
      return;
    }

    // Verify token authoritatively using Supabase Admin Client
    // This is more robust than raw axios as it uses the official SDK's resilience patterns
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);

      if (authError || !user) {
        console.warn("Supabase Auth Failed for token:", token.substring(0, 10) + "...", authError?.message);

        // If it's a timeout or network error, return 503
        if (authError?.status === 503 || authError?.message?.includes("fetch")) {
          res.status(503).json({
            success: false,
            message: "Authentication service unreachable"
          });
        } else {
          res.status(401).json({
            success: false,
            message: "Invalid or expired token"
          });
        }
        return;
      }

      // Success - Attach User
      console.log("Auth Success for user:", user.id);
      (req as any).user = user;
      next();

    } catch (err: any) {
      console.error("Unexpected Auth Error:", err.message);
      res.status(503).json({
        success: false,
        message: "Authentication service unreachable"
      });
      return;
    }

  } catch (error) {
    console.error("Auth Middleware Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal authentication error"
    });
  }
}

export function withAuth(handler: Function) {
  return async function (request: Request) {
    const authResult = await authenticateRequest(request);

    if (!authResult) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const requestWithContext = {
      ...request,
      user: authResult.user,
      session: authResult.session,
    };

    return handler(requestWithContext);
  };
}
