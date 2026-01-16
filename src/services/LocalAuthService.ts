import jwt from "jsonwebtoken";
import logger from "../monitoring/logger";

interface User {
    id: string;
    email?: string;
    role?: string;
    app_metadata?: any;
    user_metadata?: any;
}

export class LocalAuthService {
    private static jwtSecret: string | null = null;

    static initialize() {
        this.jwtSecret = process.env.SUPABASE_JWT_SECRET || null;
        if (!this.jwtSecret) {
            logger.error(
                "[CRITICAL] SUPABASE_JWT_SECRET is missing! Stateless auth will fail. Please add it to .env."
            );
        } else {
            logger.info("[Auth] Local JWT verification enabled.");
        }
    }

    static verifyToken(token: string): User {
        if (!this.jwtSecret) {
            throw new Error("SUPABASE_JWT_SECRET is not configured");
        }

        try {
            // Verify token signature and expiration
            // Supabase tokens usually have 'aud' set to 'authenticated'
            const decoded: any = jwt.verify(token, this.jwtSecret, {
                algorithms: ["HS256"], // Supabase uses HS256 by default
                audience: "authenticated", // Standard Supabase audience
            });

            // Transform into User object matching our app's expectation
            return {
                id: decoded.sub,
                email: decoded.email,
                role: decoded.role,
                app_metadata: decoded.app_metadata,
                user_metadata: decoded.user_metadata,
            };
        } catch (error: any) {
            //   if (error.name === "TokenExpiredError") {
            //     throw new Error("Token expired");
            //   }
            // Log specific verification failures if needed
            throw new Error(`Invalid token: ${error.message}`);
        }
    }
}
