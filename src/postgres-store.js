import {
  AuthorizationError,
  DependencyError,
  GoneError,
  NotFoundError,
  PreconditionError,
  RequestConflictError,
} from './errors.js';
import { SCHEMA_SQL } from './schema.js';

function mapRow(row) {
  if (!row) return null;
  return {
    code: row.code,
    ownerId: row.owner_id,
    targetUrl: row.target_url,
    requestKey: row.request_key,
    requestDigest: row.request_digest,
    createdAtMs: Number(row.created_at_ms),
    expiresAtMs: row.expires_at_ms === null ? null : Number(row.expires_at_ms),
    state: row.state,
    version: row.version,
    deactivatedAtMs: row.deactivated_at_ms === null ? null : Number(row.deactivated_at_ms),
  };
}

function dependencyFailure(error) {
  if (error instanceof DependencyError) return error;
  return new DependencyError('PostgreSQL operation failed', error);
}

export class PostgresLinkStore {
  constructor(pool) {
    this.pool = pool;
  }

  async migrate() {
    try {
      await this.pool.query(SCHEMA_SQL);
    } catch (error) {
      throw dependencyFailure(error);
    }
  }

  async ping() {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (error) {
      throw dependencyFailure(error);
    }
  }

  async findByRequest(ownerId, requestKey) {
    try {
      const result = await this.pool.query(
        'SELECT * FROM short_links WHERE owner_id = $1 AND request_key = $2',
        [ownerId, requestKey],
      );
      return mapRow(result.rows[0]);
    } catch (error) {
      throw dependencyFailure(error);
    }
  }

  async insertLink(input) {
    try {
      const result = await this.pool.query(
        `INSERT INTO short_links (
          code, owner_id, target_url, request_key, request_digest, created_at_ms, expires_at_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
        RETURNING *`,
        [
          input.code,
          input.ownerId,
          input.targetUrl,
          input.requestKey,
          input.requestDigest,
          input.createdAtMs,
          input.expiresAtMs,
        ],
      );
      if (result.rows[0]) return { created: true, link: mapRow(result.rows[0]) };

      const replay = await this.pool.query(
        'SELECT * FROM short_links WHERE owner_id = $1 AND request_key = $2',
        [input.ownerId, input.requestKey],
      );
      const row = replay.rows[0];
      if (!row) return { codeConflict: true };
      if (row.request_digest !== input.requestDigest) throw new RequestConflictError();
      return { created: false, link: mapRow(row) };
    } catch (error) {
      if (error instanceof RequestConflictError) throw error;
      throw dependencyFailure(error);
    }
  }

  async resolveLink(code, { nowMs, recordEvent, eventId }) {
    const client = await this.#connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT * FROM short_links WHERE code = $1 FOR SHARE', [code]);
      const row = result.rows[0];
      if (!row) throw new NotFoundError();
      if (row.state !== 'active' || (row.expires_at_ms !== null && Number(row.expires_at_ms) <= nowMs)) {
        throw new GoneError();
      }
      if (recordEvent) {
        await client.query(
          `INSERT INTO redirect_events (event_id, code, occurred_at_ms)
           VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING`,
          [eventId, code, nowMs],
        );
      }
      await client.query('COMMIT');
      return mapRow(row);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof NotFoundError || error instanceof GoneError) throw error;
      throw dependencyFailure(error);
    } finally {
      client.release();
    }
  }

  async getLink(code, ownerId) {
    try {
      const result = await this.pool.query('SELECT * FROM short_links WHERE code = $1', [code]);
      const link = mapRow(result.rows[0]);
      if (!link) throw new NotFoundError();
      if (link.ownerId !== ownerId) throw new AuthorizationError();
      return link;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof AuthorizationError) throw error;
      throw dependencyFailure(error);
    }
  }

  async deactivateLink(code, { ownerId, expectedVersion, nowMs }) {
    const client = await this.#connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT * FROM short_links WHERE code = $1 FOR UPDATE', [code]);
      const current = mapRow(result.rows[0]);
      if (!current) throw new NotFoundError();
      if (current.ownerId !== ownerId) throw new AuthorizationError();
      if (current.version !== expectedVersion) throw new PreconditionError();
      if (current.state === 'deactivated') {
        await client.query('COMMIT');
        return current;
      }
      const updated = await client.query(
        `UPDATE short_links
         SET state = 'deactivated', deactivated_at_ms = $2, version = version + 1
         WHERE code = $1 RETURNING *`,
        [code, nowMs],
      );
      await client.query('COMMIT');
      return mapRow(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (
        error instanceof NotFoundError
        || error instanceof AuthorizationError
        || error instanceof PreconditionError
      ) throw error;
      throw dependencyFailure(error);
    } finally {
      client.release();
    }
  }

  async countRedirectEvents(code) {
    try {
      const result = await this.pool.query(
        'SELECT count(*)::integer AS count FROM redirect_events WHERE code = $1',
        [code],
      );
      return result.rows[0].count;
    } catch (error) {
      throw dependencyFailure(error);
    }
  }

  async close() {
    await this.pool.end();
  }

  async #connect() {
    try {
      return await this.pool.connect();
    } catch (error) {
      throw dependencyFailure(error);
    }
  }
}
