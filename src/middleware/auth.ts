import { getSupabaseClient } from "../lib/supabase/client";
import {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
} from "express";
import { sendErrorResponse } from "../lib/api-response";
import { LocalAuthService } from "../services/LocalAuthService";

// Initialize Local Auth (reads env once)
LocalAuthService.initialize();

// Simple in-memory cache for auth tokens
const AUTH_CACHE_TTL = 60 * 1000; // 60 seconds
const MAX_CACHE_SIZE = 1000;
const authCache = new Map<string, { user: any; session: any; timestamp: number }>();

export async function authenticateRequest(
  request: Request
): Promise<{ user: any; session: any } | null> {
  try {
    // Get the authorization header
    const authHeader = request.headers.get("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log(
        "Authentication failed: Missing or invalid Authorization header"
      );
      return null;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Check cache
    const cached = authCache.get(token);
    if (cached) {
      if (Date.now() - cached.timestamp < AUTH_CACHE_TTL) {
        // Return cached result
        return {
          user: cached.user,
          session: cached.session
        };
      } else {
        // Expired
        authCache.delete(token);
      }
    }

    // console.log("Token extracted for authentication", {
    //   tokenLength: token.length,
    //   tokenPreview: token.substring(0, 10) + "...",
    // });

    // Verify the token with Supabase
    const supabaseClient = await getSupabaseClient();
    if (!supabaseClient) {
      console.log("Authentication failed: Supabase client not initialized");
      return null;
    }
    // console.log("Verifying token with Supabase");
    const { data, error } = await supabaseClient.auth.getUser(token);

    // Arranging logs to be less verbose
    // console.log("Supabase auth response:", { hasData: !!data, hasError: !!error });

    if (error || !data?.user) {
      console.log("Authentication failed: Supabase verification failed", {
        error: error?.message,
      });
      return null;
    }

    // Get the session
    const { data: sessionData, error: sessionError } =
      await supabaseClient.auth.getSession();

    if (sessionError) {
      console.log("Authentication failed: Session retrieval failed");
      return null;
    }

    const result = {
      user: data.user,
      session: sessionData.session,
    };

    // Update cache
    if (authCache.size >= MAX_CACHE_SIZE) {
      // Evict oldest (iterating map gives insertion order)
      const firstKey = authCache.keys().next().value;
      if (firstKey) authCache.delete(firstKey);

    }
    authCache.set(token, { ...result, timestamp: Date.now() });

    return result;
  } catch (error) {
    console.error("Authentication error:", error);
    return null;
  }
}

// Express middleware version
export async function authenticateExpressRequest(
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction
): Promise<void> {
  try {
    const authStart = Date.now();
    console.log("Authentication middleware called", {
      url: req.url,
      method: req.method,
    });

    console.log("Checking authorization header in request");
    console.log("All headers:", req.headers);
    // Get the authorization header
    const authHeader = req.headers.authorization;
    console.log("Authorization header:", authHeader);

    // Handle case where auth header might be passed in different formats
    let token: string | null = null;

    if (authHeader) {
      if (authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7); // Remove 'Bearer ' prefix
        console.log("Extracted Bearer token");
      } else if (!authHeader.includes(" ")) {
        // If it's just the token without "Bearer" prefix
        token = authHeader;
        console.log("Using raw token");
      }
    }
    console.log("Final token:", token);

    // Also check for token in query parameters as fallback (for testing)
    if (!token && req.query && typeof req.query.token === "string") {
      token = req.query.token;
    }

    if (!token) {
      console.log("Authentication failed: Authorization token missing");
      console.log("Request headers:", req.headers);
      console.log("Request query:", req.query);
      res.status(401).json({
        success: false,
        message: "Authorization token missing",
        debug: {
          hasAuthHeader: !!req.headers.authorization,
          authHeader: req.headers.authorization
            ? req.headers.authorization.substring(0, 20) + "..."
            : null,
          hasQueryToken: !!(req.query && typeof req.query.token === "string"),
          queryToken:
            req.query && typeof req.query.token === "string"
              ? req.query.token.substring(0, 10) + "..."
              : null,
        },
      });
      return;
    }

    console.log("Token extracted for authentication", {
      tokenLength: token.length,
      tokenPreview: token.substring(0, 10) + "...",
    });

    // STRATEGY 1: Stateless JWT Verification (High Performance)
    // Only works if SUPABASE_JWT_SECRET is set
    if (process.env.SUPABASE_JWT_SECRET) {
      try {
        // Verify locally - <1ms latency
        const user = LocalAuthService.verifyToken(token);

        console.log("✅ [Auth] Decoded JWT:", user); // Diagnostic Log

        (req as any).user = user;
        const authEnd = Date.now();
        (req as any).authTime = authEnd - authStart;

        return next();
      } catch (jwtError: any) {
        // If JWT verification fails locally, it might be a secret mismatch or expiration.
        // Instead of failing hard, we fall back to remote verification to be safe.
        // This fixes the "401 on User Data" if the secret is rotated or wrong.
        console.warn(`⚠️ [Auth] Local JWT Verification Failed (Falling back to remote): ${jwtError.message}`);
        // Continue execution to Strategy 2
      }
    } else {
      // Log once per process or periodically? For now, log on request (dev) or warn.
      // In production, this should cause an alert, but we continue with fallback as requested.
      console.warn("[Auth] SUPABASE_JWT_SECRET missing - falling back to slow remote auth");
    }

    // STRATEGY 2: Cached Remote Auth (Fallback)
    // Only reached if JWT Secret is missing or if local verification is not enabled.

    // Check cache
    const cached = authCache.get(token);
    if (cached) {
      if (Date.now() - cached.timestamp < AUTH_CACHE_TTL) {
        (req as any).user = cached.user;
        const authEnd = Date.now();
        (req as any).authTime = authEnd - authStart;
        next();
        return;
      } else {
        authCache.delete(token);
      }
    }

    // Verify the token with Supabase (Remote)
    // console.log("Verifying token with Supabase (Remote Fallback)");
    let data, error;
    try {
      const supabaseClient = await getSupabaseClient();
      if (!supabaseClient) {
        return sendErrorResponse(
          res,
          500,
          "Supabase client not initialized",
          "Authentication service unavailable"
        );
      }
      const result = await supabaseClient.auth.getUser(token);
      data = result.data;
      error = result.error;

      // Log the raw response for debugging
      console.log("Supabase auth response:", {
        hasData: !!data,
        hasUser: !!data?.user,
        hasError: !!error,
        error: error?.message,
      });
    } catch (networkError) {
      console.error("Network error during authentication:", networkError);
      // Check if it's a JSON parsing error
      if (
        networkError instanceof Error &&
        networkError.message.includes("JSON")
      ) {
        console.error(
          "This might be due to Supabase returning HTML instead of JSON - possible network or configuration issue"
        );
      }
      return sendErrorResponse(
        res,
        500,
        networkError instanceof Error ? networkError.message : "Network error",
        "Authentication service unavailable"
      );
    }

    if (error) {
      console.log("Authentication failed: Supabase error", {
        error: error.message
      });
      return sendErrorResponse(
        res,
        401,
        error.message,
        "Invalid or expired token"
      );
    }

    if (!data?.user) {
      console.log("Authentication failed: No user data returned");
      return sendErrorResponse(
        res,
        401,
        "No user data returned",
        "Invalid or expired token"
      );
    }

    // Attach user to request object
    console.log("Authentication successful for user:", data.user.id);
    (req as any).user = data.user;

    // Update Cache
    if (authCache.size >= MAX_CACHE_SIZE) {
      const firstKey = authCache.keys().next().value;
      if (firstKey) authCache.delete(firstKey);
    }
    // We don't have session object easily here without another call, but we only need user for express usually?
    // The previous implementation didn't call getSession in express middleware, only getUser.
    // So we cache { user, session: null } for consistency or update type?
    // The `authenticateRequest` (edge) returns session. The express one only attaches user.
    // We will cache just user.
    authCache.set(token, { user: data.user, session: null, timestamp: Date.now() });

    // Calculate and store auth duration
    const authEnd = Date.now();
    (req as any).authTime = authEnd - authStart;

    next();
  } catch (error) {
    console.error("Authentication error:", error);
    return sendErrorResponse(
      res,
      500,
      error instanceof Error ? error.message : "Unknown error",
      "Authentication failed"
    );
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

    // Add user and session to request context
    const requestWithContext = {
      ...request,
      user: authResult.user,
      session: authResult.session,
    };

    return handler(requestWithContext);
  };
}
