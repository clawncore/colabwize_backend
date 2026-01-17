import { getSupabaseAdminClient } from "../lib/supabase/client";
import {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
} from "express";
import { sendErrorResponse } from "../lib/api-response";

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

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        message: "Missing or invalid authorization header"
      });
      return;
    }

    const token = authHeader.substring(7);

    const supabase = await getSupabaseAdminClient();
    if (!supabase) {
      console.error("Critical: Supabase Admin Client not available");
      res.status(500).json({
        success: false,
        message: "Authentication service unavailable"
      });
      return;
    }

    // Verify token authoritatively
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      // console.warn("Supabase Auth Failed:", error?.message);
      res.status(401).json({
        success: false,
        message: "Invalid or expired token"
      });
      return;
    }

    // Success - Attach User
    (req as any).user = data.user;
    next();

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
