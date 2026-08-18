import { createHash } from 'node:crypto';
import { ValidationError } from './errors.js';

const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUEST_KEY_PATTERN = /^[\x21-\x7e]{8,128}$/;

export function normalizeOwnerId(value) {
  if (typeof value !== 'string' || !OWNER_PATTERN.test(value)) {
    throw new ValidationError('owner identity is invalid');
  }
  return value;
}

export function normalizeRequestKey(value) {
  if (typeof value !== 'string' || !REQUEST_KEY_PATTERN.test(value)) {
    throw new ValidationError('Idempotency-Key must contain 8-128 visible ASCII characters');
  }
  return value;
}

export function normalizeExpiration(value, nowMs) {
  if (value === undefined || value === null) return null;
  const expiresAtMs = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new ValidationError('expiresAt must be an ISO-8601 instant or integer epoch milliseconds');
  }
  if (expiresAtMs <= nowMs) throw new ValidationError('expiresAt must be in the future');
  const tenYearsMs = 10 * 366 * 24 * 60 * 60 * 1000;
  if (expiresAtMs - nowMs > tenYearsMs) {
    throw new ValidationError('expiresAt cannot be more than ten years in the future');
  }
  return expiresAtMs;
}

export function requestDigest({ targetUrl, expiresAtMs, customCode }) {
  const canonical = JSON.stringify({
    customCode: customCode ?? null,
    expiresAtMs: expiresAtMs ?? null,
    targetUrl,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function cloneLink(link) {
  return link ? { ...link } : null;
}
