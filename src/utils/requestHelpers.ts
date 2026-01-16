
import { Request } from 'express';

/**
 * Safely extracts a string from a query parameter or body field.
 * Handles string | string[] | undefined | null | unknown.
 * Returns undefined if the value is not a string or empty.
 */
export function getSafeString(value: unknown): string | undefined {
    if (typeof value === 'string') {
        return value.trim() || undefined;
    }
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
        return value[0].trim() || undefined;
    }
    return undefined;
}

/**
 * Enforces a string return, throwing an error if missing.
 * Useful for required parameters.
 */
export function getRequiredString(value: unknown, fieldName: string): string {
    const str = getSafeString(value);
    if (!str) {
        throw new Error(`${fieldName} is required`);
    }
    return str;
}

/**
 * Safely extracts a number from a value.
 */
export function getSafeNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && !isNaN(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = parseFloat(value);
        if (!isNaN(parsed)) {
            return parsed;
        }
    }
    return undefined;
}

/**
 * Generic interface for typed Request Body.
 * Usage: Request<{}, {}, TypedBody>
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TypedRequest<BodyType = any, QueryType = any> = Request<any, any, BodyType, QueryType>;
