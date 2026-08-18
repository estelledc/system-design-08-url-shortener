import { randomInt } from 'node:crypto';
import { ValidationError } from './errors.js';

export const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const DEFAULT_CODE_LENGTH = 8;
const CUSTOM_CODE_PATTERN = /^[0-9A-Za-z_-]{4,32}$/;

export function codeSpace(length = DEFAULT_CODE_LENGTH) {
  assertLength(length);
  return BigInt(BASE62_ALPHABET.length) ** BigInt(length);
}

export function createRandomCode({ length = DEFAULT_CODE_LENGTH, randomIndex = randomInt } = {}) {
  assertLength(length);
  let code = '';
  for (let index = 0; index < length; index += 1) {
    const value = randomIndex(BASE62_ALPHABET.length);
    if (!Number.isInteger(value) || value < 0 || value >= BASE62_ALPHABET.length) {
      throw new TypeError('randomIndex returned a value outside the Base62 alphabet');
    }
    code += BASE62_ALPHABET[value];
  }
  return code;
}

export function encodeBase62(value) {
  let remaining = BigInt(value);
  if (remaining < 0n) throw new RangeError('Base62 value must be non-negative');
  if (remaining === 0n) return BASE62_ALPHABET[0];
  let encoded = '';
  while (remaining > 0n) {
    encoded = BASE62_ALPHABET[Number(remaining % 62n)] + encoded;
    remaining /= 62n;
  }
  return encoded;
}

export function normalizeCode(value) {
  if (typeof value !== 'string' || !CUSTOM_CODE_PATTERN.test(value)) {
    throw new ValidationError('short code must contain 4-32 ASCII letters, digits, hyphens, or underscores');
  }
  return value;
}

function assertLength(length) {
  if (!Number.isInteger(length) || length < 4 || length > 32) {
    throw new RangeError('code length must be an integer from 4 through 32');
  }
}
