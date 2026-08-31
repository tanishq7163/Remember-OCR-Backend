import rateLimit from 'express-rate-limit';
import { config } from '../../config';

export const rateLimitMiddleware = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
  // Key on userId (from auth header) if available, otherwise IP
  keyGenerator: (req) => {
    const auth = req.headers['authorization'];
    if (auth?.startsWith('Bearer ')) {
      // Use only first 16 chars of token as key — never log full token
      return auth.slice(7, 23);
    }
    return req.ip ?? 'unknown';
  },
});
