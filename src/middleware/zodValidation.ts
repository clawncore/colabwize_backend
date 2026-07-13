import { Request, Response, NextFunction } from "express";
// Fix: AnyZodObject is not exported by Zod directly in some versions, use ZodObject<any> or ZodSchema
import { ZodSchema, ZodError } from "zod";
import logger from "../monitoring/logger";

/**
 * Factory for creating Zod validation middleware.
 * Validates req.body, req.query, and req.params against the provided schema.
 * 
 * @param schema - The Zod schema to validate against (usually z.object({...}))
 */
export const validateRequest = (schema: ZodSchema) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            // safeParse is used so we can handle errors gracefully
            // We parse body, query, and params. 
            // Note: If schema only defines 'body', then query/params are ignored by Zod's strip() behavior if configured,
            // or we can explicitly validate parts.
            // Usually, it's better to expect a schema shape like { body: z.object(...), query: ... } 
            // OR just validate the body if that's what is passed.

            // However, typical usage is passing a schema for the Body.
            // Let's assume the schema passed IS the body schema, or a combined one?
            // Best practice: Schema should define { body, query, params } keys if needed.
            // But commonly, simple "validateRequest(loginSchema)" implies body.

            // To be robust, let's just parse the whole request object against a schema that expects { body, query, params }
            // But most Zod definitions for APIs are just the data structure.

            // Let's implement the { body: schema } pattern for strictness.
            // Callers should pass: z.object({ body: z.object({ ... }) })

            await schema.parseAsync({
                body: req.body,
                query: req.query,
                params: req.params,
            });

            next();
        } catch (error) {
            if (error instanceof ZodError) {
                // Log the security event (sanitized)
                logger.warn("Validation failed", {
                    path: req.path,
                    ip: req.ip,
                    errors: error.issues.map(e => ({ path: e.path, message: e.message }))
                });

                return res.status(400).json({
                    success: false,
                    error: "Invalid request data",
                    details: (error as ZodError).issues.map((e: any) => ({
                        field: e.path.join("."),
                        message: e.message,
                    })),
                });
            }

            // Internal validation error
            logger.error("Unexpected validation error", { error });
            return res.status(500).json({ success: false, error: "Internal validation error" });
        }
    };
};
