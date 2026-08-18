import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import {
  createHttpServer,
  LinkService,
  MemoryLinkStore,
  StaticBearerAuthenticator,
} from '../../src/index.js';

const TOKEN = 'test-bearer-token-00000001';

async function withServer(run) {
  const logs = [];
  const store = new MemoryLinkStore();
  let counter = 0;
  const service = new LinkService({
    store,
    publicBaseUrl: 'https://short.example',
    clock: () => 1_800_000_000_000,
    codeGenerator: () => `http${String(counter += 1).padStart(4, '0')}`,
  });
  const authenticator = new StaticBearerAuthenticator([{ token: TOKEN, ownerId: 'owner-a' }]);
  const server = createHttpServer({ service, authenticator, logger: (record) => logs.push(record) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ base, logs, store });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function createRequest(base, body, key = 'http-request-key-0001') {
  return fetch(`${base}/v1/links`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    body: JSON.stringify(body),
  });
}

test('HTTP creation, replay, owner lookup, redirect receipt, and deactivation form one vertical slice', async () => {
  await withServer(async ({ base, store }) => {
    const targetUrl = 'https://example.com/article?q=1';
    const createdResponse = await createRequest(base, { targetUrl });
    assert.equal(createdResponse.status, 201);
    assert.equal(createdResponse.headers.get('etag'), '"1"');
    const created = await createdResponse.json();

    const replayResponse = await createRequest(base, { targetUrl });
    assert.equal(replayResponse.status, 200);
    assert.deepEqual(await replayResponse.json(), created);

    const metadataResponse = await fetch(`${base}/v1/links/${created.code}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(metadataResponse.status, 200);

    const headResponse = await fetch(`${base}/r/${created.code}`, { method: 'HEAD', redirect: 'manual' });
    assert.equal(headResponse.status, 302);
    assert.equal(await store.countRedirectEvents(created.code), 0);

    const redirectResponse = await fetch(`${base}/r/${created.code}`, { redirect: 'manual' });
    assert.equal(redirectResponse.status, 302);
    assert.equal(redirectResponse.headers.get('location'), targetUrl);
    assert.equal(redirectResponse.headers.get('cache-control'), 'no-store');
    assert.equal(await store.countRedirectEvents(created.code), 1);

    const staleDelete = await fetch(`${base}/v1/links/${created.code}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN}`, 'if-match': '"2"' },
    });
    assert.equal(staleDelete.status, 412);

    const deleted = await fetch(`${base}/v1/links/${created.code}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN}`, 'if-match': '"1"' },
    });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).state, 'deactivated');
    assert.equal((await fetch(`${base}/r/${created.code}`, { redirect: 'manual' })).status, 410);
  });
});

test('HTTP boundary rejects unauthenticated, conflicting, and unsafe creation requests', async () => {
  await withServer(async ({ base }) => {
    const unauthenticated = await fetch(`${base}/v1/links`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(unauthenticated.status, 401);

    const first = await createRequest(base, { targetUrl: 'https://example.com/a' });
    assert.equal(first.status, 201);
    const conflict = await createRequest(base, { targetUrl: 'https://example.com/b' });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, 'idempotency_conflict');

    const unsafe = await createRequest(
      base,
      { targetUrl: 'javascript:alert(1)' },
      'http-request-key-0002',
    );
    assert.equal(unsafe.status, 400);
  });
});

test('structured logs omit credentials, request identity, target, code, and event identity', async () => {
  await withServer(async ({ base, logs }) => {
    const target = 'https://example.com/private-path';
    const response = await createRequest(base, { targetUrl: target }, 'sensitive-request-key');
    const created = await response.json();
    await fetch(`${base}/r/${created.code}`, { redirect: 'manual' });
    const text = JSON.stringify(logs);
    assert.ok(!text.includes(TOKEN));
    assert.ok(!text.includes('sensitive-request-key'));
    assert.ok(!text.includes(target));
    assert.ok(!text.includes(created.code));
    assert.match(text, /create_link/);
    assert.match(text, /resolve_get/);
  });
});
