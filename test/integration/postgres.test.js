import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { Pool } from 'pg';
import {
  AliasConflictError,
  GoneError,
  LinkService,
  PostgresLinkStore,
  RequestConflictError,
} from '../../src/index.js';

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, 'DATABASE_URL is required for PostgreSQL integration tests');

let pool;
let store;

before(async () => {
  pool = new Pool({ connectionString: databaseUrl, max: 20 });
  store = new PostgresLinkStore(pool);
  await store.migrate();
});

beforeEach(async () => {
  await pool.query('TRUNCATE redirect_events, short_links');
});

after(async () => {
  await pool.end();
});

function service(options = {}) {
  return new LinkService({
    store,
    publicBaseUrl: 'https://short.example',
    clock: () => 1_800_000_000_000,
    ...options,
  });
}

test('real unique constraints converge 32 concurrent duplicate requests', async () => {
  let index = 0;
  const app = service({ codeGenerator: () => `pg${String(index += 1).padStart(6, '0')}` });
  const request = {
    ownerId: 'owner-a',
    idempotencyKey: 'postgres-race-key',
    targetUrl: 'https://example.com/race',
  };
  const results = await Promise.all(Array.from({ length: 32 }, () => app.createLink(request)));
  assert.equal(new Set(results.map((result) => result.link.code)).size, 1);
  assert.equal(results.filter((result) => result.created).length, 1);
  const rows = await pool.query('SELECT count(*)::integer AS count FROM short_links');
  assert.equal(rows.rows[0].count, 1);
});

test('primary-key collision is retried while a custom alias remains reserved', async () => {
  const seed = service({ codeGenerator: () => 'fixed001' });
  await seed.createLink({
    ownerId: 'owner-a', idempotencyKey: 'postgres-key-0001', targetUrl: 'https://example.com/a',
  });
  const codes = ['fixed001', 'fixed002'];
  const app = service({ codeGenerator: () => codes.shift() });
  const created = await app.createLink({
    ownerId: 'owner-b', idempotencyKey: 'postgres-key-0002', targetUrl: 'https://example.com/b',
  });
  assert.equal(created.link.code, 'fixed002');
  await assert.rejects(
    app.createLink({
      ownerId: 'owner-c',
      idempotencyKey: 'postgres-key-0003',
      targetUrl: 'https://example.com/c',
      customCode: 'fixed001',
    }),
    AliasConflictError,
  );
});

test('stored request digest rejects an idempotency payload change', async () => {
  const app = service({ codeGenerator: () => 'digest01' });
  await app.createLink({
    ownerId: 'owner-a', idempotencyKey: 'postgres-key-0001', targetUrl: 'https://example.com/a',
  });
  await assert.rejects(
    app.createLink({
      ownerId: 'owner-a', idempotencyKey: 'postgres-key-0001', targetUrl: 'https://example.com/b',
    }),
    RequestConflictError,
  );
});

test('redirect event commits with the active lookup and survives a new store instance', async () => {
  const app = service({ codeGenerator: () => 'event001' });
  const created = await app.createLink({
    ownerId: 'owner-a', idempotencyKey: 'postgres-key-0001', targetUrl: 'https://example.com/a',
  });
  await app.resolve(created.link.code);
  const secondStore = new PostgresLinkStore(pool);
  assert.equal(await secondStore.countRedirectEvents(created.link.code), 1);
  assert.equal((await secondStore.findByRequest('owner-a', 'postgres-key-0001')).code, created.link.code);
});

test('deactivation is versioned and never frees a code for reassignment', async () => {
  const app = service();
  const created = await app.createLink({
    ownerId: 'owner-a',
    idempotencyKey: 'postgres-key-0001',
    targetUrl: 'https://example.com/a',
    customCode: 'durable-alias',
  });
  const removed = await app.deactivate(created.link.code, { ownerId: 'owner-a', expectedVersion: 1 });
  assert.equal(removed.version, 2);
  await assert.rejects(app.resolve(created.link.code), GoneError);
  await assert.rejects(
    app.createLink({
      ownerId: 'owner-b',
      idempotencyKey: 'postgres-key-0002',
      targetUrl: 'https://example.com/b',
      customCode: 'durable-alias',
    }),
    AliasConflictError,
  );
});
