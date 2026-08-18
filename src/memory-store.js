import {
  AuthorizationError,
  GoneError,
  NotFoundError,
  PreconditionError,
  RequestConflictError,
} from './errors.js';
import { cloneLink } from './contracts.js';

function requestIndexKey(ownerId, requestKey) {
  return `${ownerId.length}:${ownerId}${requestKey}`;
}

export class MemoryLinkStore {
  #links = new Map();
  #requests = new Map();
  #events = new Map();

  async ping() {
    return true;
  }

  async findByRequest(ownerId, requestKey) {
    const code = this.#requests.get(requestIndexKey(ownerId, requestKey));
    return cloneLink(code ? this.#links.get(code) : null);
  }

  async insertLink(input) {
    const indexKey = requestIndexKey(input.ownerId, input.requestKey);
    const requestCode = this.#requests.get(indexKey);
    if (requestCode) {
      const existing = this.#links.get(requestCode);
      if (existing.requestDigest !== input.requestDigest) throw new RequestConflictError();
      return { created: false, link: cloneLink(existing) };
    }
    if (this.#links.has(input.code)) return { codeConflict: true };

    const link = {
      code: input.code,
      ownerId: input.ownerId,
      targetUrl: input.targetUrl,
      requestKey: input.requestKey,
      requestDigest: input.requestDigest,
      createdAtMs: input.createdAtMs,
      expiresAtMs: input.expiresAtMs,
      state: 'active',
      version: 1,
      deactivatedAtMs: null,
    };
    this.#links.set(link.code, link);
    this.#requests.set(indexKey, link.code);
    return { created: true, link: cloneLink(link) };
  }

  async resolveLink(code, { nowMs, recordEvent, eventId }) {
    const link = this.#links.get(code);
    if (!link) throw new NotFoundError();
    if (link.state !== 'active' || (link.expiresAtMs !== null && link.expiresAtMs <= nowMs)) {
      throw new GoneError();
    }
    if (recordEvent) {
      this.#events.set(eventId, { eventId, code, occurredAtMs: nowMs });
    }
    return cloneLink(link);
  }

  async getLink(code, ownerId) {
    const link = this.#links.get(code);
    if (!link) throw new NotFoundError();
    if (link.ownerId !== ownerId) throw new AuthorizationError();
    return cloneLink(link);
  }

  async deactivateLink(code, { ownerId, expectedVersion, nowMs }) {
    const link = this.#links.get(code);
    if (!link) throw new NotFoundError();
    if (link.ownerId !== ownerId) throw new AuthorizationError();
    if (link.version !== expectedVersion) throw new PreconditionError();
    if (link.state === 'deactivated') return cloneLink(link);
    link.state = 'deactivated';
    link.deactivatedAtMs = nowMs;
    link.version += 1;
    return cloneLink(link);
  }

  async countRedirectEvents(code) {
    let count = 0;
    for (const event of this.#events.values()) {
      if (event.code === code) count += 1;
    }
    return count;
  }

  async close() {}
}
