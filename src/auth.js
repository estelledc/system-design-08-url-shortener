import { createHash, timingSafeEqual } from 'node:crypto';
import { AuthenticationError, ValidationError } from './errors.js';

function digest(value) {
  return createHash('sha256').update(value).digest();
}

export class StaticBearerAuthenticator {
  #entries;

  constructor(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new ValidationError('at least one static bearer credential is required');
    }
    this.#entries = entries.map(({ token, ownerId }) => {
      if (typeof token !== 'string' || token.length < 16 || token.length > 512) {
        throw new ValidationError('bearer tokens must contain 16-512 characters');
      }
      if (typeof ownerId !== 'string' || ownerId.length === 0) {
        throw new ValidationError('bearer credential ownerId is required');
      }
      return { tokenDigest: digest(token), ownerId };
    });
  }

  authenticate(header) {
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new AuthenticationError();
    }
    const supplied = digest(header.slice('Bearer '.length));
    let matched = null;
    for (const entry of this.#entries) {
      if (timingSafeEqual(entry.tokenDigest, supplied)) matched = entry.ownerId;
    }
    if (!matched) throw new AuthenticationError();
    return matched;
  }

  static fromJson(value) {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ValidationError('AUTH_TOKENS_JSON must be valid JSON');
    }
    if (!Array.isArray(parsed)) {
      throw new ValidationError('AUTH_TOKENS_JSON must be an array of token/ownerId objects');
    }
    return new StaticBearerAuthenticator(parsed);
  }
}
