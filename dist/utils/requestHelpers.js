"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSafeString = getSafeString;
exports.getRequiredString = getRequiredString;
exports.getSafeNumber = getSafeNumber;
/**
 * Safely extracts a string from a query parameter or body field.
 * Handles string | string[] | undefined | null | unknown.
 * Returns undefined if the value is not a string or empty.
 */
function getSafeString(value) {
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
function getRequiredString(value, fieldName) {
    const str = getSafeString(value);
    if (!str) {
        throw new Error(`${fieldName} is required`);
    }
    return str;
}
/**
 * Safely extracts a number from a value.
 */
function getSafeNumber(value) {
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
