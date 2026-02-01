import { rateLimit } from "express-rate-limit";
import logger from "../monitoring/logger";

// General API Rate Limiter
// 100 requests per minute
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later."
  },
  handler: (req, res, next, options) => {
    logger.warn(`Rate limit exceeded: ${req.ip} -> ${req.originalUrl}`);
    res.status(options.statusCode).send(options.message);
  }
});

// Stricter Auth Rate Limiter
// 10 requests per minute to prevent brute force
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts, please try again later."
  },
  handler: (req, res, next, options) => {
    logger.warn(`Auth Rate limit exceeded: ${req.ip}`);
    res.status(options.statusCode).send(options.message);
  }
});

// AI/Upload Heavy Operation Limiter
// 20 requests per minute for resource intensive operations
export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Upload/AI limit reached, please slow down."
  },
  handler: (req, res, next, options) => {
    logger.warn(`Upload Rate limit exceeded: ${req.ip} -> ${req.originalUrl}`);
    res.status(options.statusCode).send(options.message);
  }
});

// Admin Operation Limiter (Internal)
export const adminOperationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

