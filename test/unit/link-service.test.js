import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AliasConflictError,
  AuthorizationError,
  CodeSpaceExhaustedError,
  GoneError,
  LinkService,
  MemoryLinkStore,
  PreconditionError,
  RequestConflictError,
} from '../../src/index.js';

function sequence(values) {
  const queue = [...values];
  return () => {
    if (queue.length === 0) throw new Error('test code sequence exhausted');
    return queue.shift();
  };
}

function fixture({ codes = ['a0000001', 'a0000002', 'a0000003'], nowMs = 1_800_000_000_000 } = {}) {
  const store = new MemoryLinkStore();
  let currentMs = nowMs;
  const service = new LinkService({
    store,
    publicBaseUrl: 'https://short.example',
    clock: () => currentMs,
    codeGenerator: sequence(codes),
  });
  return { store, service, advance: (delta) => { currentMs += delta; } };
}

test('same owner and idempotency key replays one immutable allocation', async () => {
  const { service } = fixture();
  const request = {
    ownerId: 'owner-a',
    idempotencyKey: 'request-key-0001',
    targetUrl: 'https://example.com/article',
  };
  const first = await service.createLink(request);
  const replay = await service.createLink(request);
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.deepEqual(replay.link, first.link);
  await assert.rejects(
    service.createLink({ ...request, targetUrl: 'https://example.com/changed' }),
    RequestConflictError,
  );
});

test('same target with different request intent creates different links', async () => {
  const { service } = fixture();
  const first = await service.createLink({
    ownerId: 'owner-a', idempotencyKey: 'request-key-0001', targetUrl: 'https://example.com/a',
  });
  const second = await service.createLink({
    ownerId: 'owner-a', idempotencyKey: 'request-key-0002', targetUrl: 'https://example.com/a',
  });
  assert.notEqual(first.link.code, second.link.code);
});

test('database-style code collision is retried but a custom alias collision is not', async () => {
  const { service } = fixture({ codes: ['sameCode', 'sameCode', 'nextCode'] });
  const first = await service.createLink({
    ownerId: 'owner-a', idempotencyKey: 'request-key-0001', targetUrl: 'https://example.com/a',
  });
  const second = await service.createLink({
    ownerId: 'owner-b', idempotencyKey: 'request-key-0002', targetUrl: 'https://example.com/b',
  });
  assert.equal(first.link.code, 'sameCode');
  assert.equal(second.link.code, 'nextCode');
  await assert.rejects(
    service.createLink({
      ownerId: 'owner-c',
      idempotencyKey: 'request-key-0003',
      targetUrl: 'https://example.com/c',
      customCode: 'sameCode',
    }),
    AliasConflictError,
  );
});

test('bounded allocation fails closed when every generated code is occupied', async () => {
  const { store } = fixture();
  await store.insertLink({
    code: 'occupied', ownerId: 'seed', targetUrl: 'https://example.com/', requestKey: 'seed-key-0001',
    requestDigest: 'a'.repeat(64), createdAtMs: 1, expiresAtMs: null,
  });
  const service = new LinkService({
    store,
    codeGenerator: () => 'occupied',
    maxAllocationAttempts: 3,
    clock: () => 2,
  });
  await assert.rejects(
    service.createLink({
      ownerId: 'owner-a', idempotencyKey: 'request-key-0001', targetUrl: 'https://example.com/a',
    }),
    CodeSpaceExhaustedError,
  );
});

test('concurrent duplicate requests converge on one code', async () => {
  const { service } = fixture({ codes: Array.from({ length: 32 }, (_, index) => `code${String(index).padStart(4, '0')}`) });
  const results = await Promise.all(Array.from({ length: 32 }, () => service.createLink({
    ownerId: 'owner-a', idempotencyKey: 'request-key-race', targetUrl: 'https://example.com/race',
  })));
  assert.equal(new Set(results.map((result) => result.link.code)).size, 1);
  assert.equal(results.filter((result) => result.created).length, 1);
});

test('GET records durable attempts, HEAD does not, and expiry stops both', async () => {
  const { service, store, advance } = fixture();
  const created = await service.createLink({
    ownerId: 'owner-a',
    idempotencyKey: 'request-key-0001',
    targetUrl: 'https://example.com/a',
    expiresAt: 1_800_000_001_000,
  });
  await service.resolve(created.link.code);
  await service.resolve(created.link.code, { recordEvent: false });
  assert.equal(await store.countRedirectEvents(created.link.code), 1);
  advance(1_000);
  await assert.rejects(service.resolve(created.link.code), GoneError);
});

test('owner and version gates protect deactivation, and a tombstoned code is never reusable', async () => {
  const { service } = fixture();
  const created = await service.createLink({
    ownerId: 'owner-a',
    idempotencyKey: 'request-key-0001',
    targetUrl: 'https://example.com/a',
    customCode: 'my-alias',
  });
  await assert.rejects(service.getLink(created.link.code, 'owner-b'), AuthorizationError);
  await assert.rejects(
    service.deactivate(created.link.code, { ownerId: 'owner-a', expectedVersion: 2 }),
    PreconditionError,
  );
  const deactivated = await service.deactivate(created.link.code, {
    ownerId: 'owner-a', expectedVersion: 1,
  });
  assert.equal(deactivated.state, 'deactivated');
  assert.equal(deactivated.version, 2);
  await assert.rejects(service.resolve(created.link.code), GoneError);
  await assert.rejects(
    service.createLink({
      ownerId: 'owner-b',
      idempotencyKey: 'request-key-0002',
      targetUrl: 'https://example.com/b',
      customCode: 'my-alias',
    }),
    AliasConflictError,
  );
});
