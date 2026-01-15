import { getSupabaseClient } from "../lib/supabase/client";
import {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
} from "express";
import { sendErrorResponse } from "../lib/api-response";

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
    console.log("Token extracted for authentication", {
      tokenLength: token.length,
      tokenPreview: token.substring(0, 10) + "...",
    });

    // Verify the token with Supabase
    const supabaseClient = await getSupabaseClient();
    if (!supabaseClient) {
      console.log("Authentication failed: Supabase client not initialized");
      return null;
    }
    console.log("Verifying token with Supabase");
    const { data, error } = await supabaseClient.auth.getUser(token);

    // Log the raw response for debugging
    console.log("Supabase auth response:", {
      hasData: !!data,
      hasUser: !!data?.user,
      hasError: !!error,
      error: error?.message,
    });

    if (error || !data?.user) {
      console.log("Authentication failed: Supabase verification failed", {
        error: error?.message,
        hasUserData: !!data?.user,
      });
      return null;
    }

    // Get the session
    const { data: sessionData, error: sessionError } =
      await supabaseClient.auth.getSession();

    if (sessionError) {
      console.log("Authentication failed: Session retrieval failed", {
        error: sessionError?.message,
      });
      return null;
    }

    return {
      user: data.user,
      session: sessionData.session,
    };
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

    // Verify the token with Supabase
    console.log("Verifying token with Supabase");
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
        return;
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
      return;
    }

    if (error) {
      console.log("Authentication failed: Supabase error", {
        error: error.message,
        errorDetails: error,
      });
      return sendErrorResponse(
        res,
        401,
        error.message,
        "Invalid or expired token"
      );
      return;
    }

    if (!data?.user) {
      console.log("Authentication failed: No user data returned");
      return sendErrorResponse(
        res,
        401,
        "No user data returned",
        "Invalid or expired token"
      );
      return;
    }

    // Attach user to request object
    console.log("Authentication successful for user:", data.user.id);
    (req as any).user = data.user;
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
