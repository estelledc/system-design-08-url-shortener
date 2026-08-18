import { ValidationError } from './errors.js';

export const MAX_TARGET_BYTES = 4096;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export function normalizeTargetUrl(value, { blockedHosts = [] } = {}) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError('targetUrl must be a non-empty string');
  }
  if (CONTROL_CHARACTER.test(value)) {
    throw new ValidationError('targetUrl cannot contain control characters');
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_TARGET_BYTES) {
    throw new ValidationError(`targetUrl cannot exceed ${MAX_TARGET_BYTES} UTF-8 bytes`);
  }

  let target;
  try {
    target = new URL(value);
  } catch {
    throw new ValidationError('targetUrl must be an absolute URL');
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new ValidationError('targetUrl scheme must be http or https');
  }
  if (!target.hostname) throw new ValidationError('targetUrl must include a hostname');
  if (target.username || target.password) {
    throw new ValidationError('targetUrl cannot contain embedded credentials');
  }

  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const denied = new Set(blockedHosts.map((host) => String(host).toLowerCase()));
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || denied.has(hostname)) {
    throw new ValidationError('targetUrl hostname is blocked by service policy');
  }

  const normalized = target.href;
  if (Buffer.byteLength(normalized, 'utf8') > MAX_TARGET_BYTES) {
    throw new ValidationError(`normalized targetUrl cannot exceed ${MAX_TARGET_BYTES} UTF-8 bytes`);
  }
  return normalized;
}
