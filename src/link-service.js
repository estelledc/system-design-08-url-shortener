import { randomUUID } from 'node:crypto';
import { createRandomCode, normalizeCode } from './code.js';
import {
  AliasConflictError,
  CodeSpaceExhaustedError,
  RequestConflictError,
  ValidationError,
} from './errors.js';
import {
  normalizeExpiration,
  normalizeOwnerId,
  normalizeRequestKey,
  requestDigest,
} from './contracts.js';
import { normalizeTargetUrl } from './url-policy.js';

export class LinkService {
  constructor({
    store,
    publicBaseUrl = 'https://sho.rt',
    clock = () => Date.now(),
    codeGenerator = () => createRandomCode(),
    maxAllocationAttempts = 12,
    blockedTargetHosts = [],
  }) {
    if (!store) throw new TypeError('store is required');
    if (!Number.isInteger(maxAllocationAttempts) || maxAllocationAttempts < 1 || maxAllocationAttempts > 100) {
      throw new RangeError('maxAllocationAttempts must be from 1 through 100');
    }
    const base = new URL(publicBaseUrl);
    if (base.protocol !== 'http:' && base.protocol !== 'https:') {
      throw new TypeError('publicBaseUrl must use http or https');
    }
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/') {
      throw new TypeError('publicBaseUrl must be an origin without credentials, path, query, or fragment');
    }
    this.store = store;
    this.publicBaseUrl = base.href.replace(/\/$/u, '');
    this.clock = clock;
    this.codeGenerator = codeGenerator;
    this.maxAllocationAttempts = maxAllocationAttempts;
    this.blockedTargetHosts = [...blockedTargetHosts, base.hostname];
  }

  async ready() {
    return this.store.ping();
  }

  async createLink({ ownerId, idempotencyKey, targetUrl, expiresAt, customCode }) {
    const owner = normalizeOwnerId(ownerId);
    const key = normalizeRequestKey(idempotencyKey);
    const nowMs = this.clock();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError('clock returned an invalid epoch');
    const target = normalizeTargetUrl(targetUrl, { blockedHosts: this.blockedTargetHosts });
    const expiration = normalizeExpiration(expiresAt, nowMs);
    const requestedCode = customCode === undefined ? null : normalizeCode(customCode);
    const digest = requestDigest({ targetUrl: target, expiresAtMs: expiration, customCode: requestedCode });

    const prior = await this.store.findByRequest(owner, key);
    if (prior) return this.#replay(prior, digest);

    const attempts = requestedCode ? 1 : this.maxAllocationAttempts;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const code = requestedCode ?? normalizeCode(this.codeGenerator());
      const result = await this.store.insertLink({
        code,
        ownerId: owner,
        targetUrl: target,
        requestKey: key,
        requestDigest: digest,
        createdAtMs: nowMs,
        expiresAtMs: expiration,
      });
      if (!result.codeConflict) return this.#result(result.link, result.created);

      const raced = await this.store.findByRequest(owner, key);
      if (raced) return this.#replay(raced, digest);
      if (requestedCode) throw new AliasConflictError();
    }
    throw new CodeSpaceExhaustedError();
  }

  async resolve(code, { recordEvent = true } = {}) {
    const normalized = normalizeCode(code);
    const nowMs = this.clock();
    const link = await this.store.resolveLink(normalized, {
      nowMs,
      recordEvent,
      eventId: randomUUID(),
    });
    return { targetUrl: link.targetUrl, code: link.code };
  }

  async getLink(code, ownerId) {
    const link = await this.store.getLink(normalizeCode(code), normalizeOwnerId(ownerId));
    return this.#publicLink(link);
  }

  async deactivate(code, { ownerId, expectedVersion }) {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new ValidationError('If-Match must contain a positive integer link version');
    }
    const link = await this.store.deactivateLink(normalizeCode(code), {
      ownerId: normalizeOwnerId(ownerId),
      expectedVersion,
      nowMs: this.clock(),
    });
    return this.#publicLink(link);
  }

  #replay(link, digest) {
    if (link.requestDigest !== digest) throw new RequestConflictError();
    return this.#result(link, false);
  }

  #result(link, created) {
    return { created, link: this.#publicLink(link) };
  }

  #publicLink(link) {
    return {
      code: link.code,
      shortUrl: `${this.publicBaseUrl}/r/${encodeURIComponent(link.code)}`,
      targetUrl: link.targetUrl,
      createdAt: new Date(link.createdAtMs).toISOString(),
      expiresAt: link.expiresAtMs === null ? null : new Date(link.expiresAtMs).toISOString(),
      state: link.state,
      version: link.version,
    };
  }
}
