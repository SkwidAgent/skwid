import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.mjs';

const digest = (value) => createHash('sha256').update(value).digest();

export function requireAdmin(config) {
  return (req, _res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!config.adminToken || !token || !timingSafeEqual(digest(token), digest(config.adminToken))) {
      return next(new HttpError(401, 'unauthorized', 'Owner authentication required.'));
    }
    next();
  };
}

export function hashRemoteAddress(value) {
  return createHash('sha256').update(value || 'unknown').digest('hex');
}
