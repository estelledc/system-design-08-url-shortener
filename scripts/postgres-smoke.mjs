import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';
import { PostgresLinkStore } from '../src/index.js';

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, 'DATABASE_URL is required for the PostgreSQL runtime smoke');

const token = 'runtime-smoke-token-00000001';
const idempotencyKey = 'runtime-smoke-request-0001';
const targetUrl = 'https://example.com/runtime-smoke';

function startServer() {
  const child = spawn(process.execPath, ['src/main.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: '0',
      PUBLIC_BASE_URL: 'https://short.example',
      AUTH_TOKENS_JSON: JSON.stringify([{ token, ownerId: 'smoke-owner' }]),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const listening = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server start timed out: ${stderr}`)), 10_000);
    const inspect = (chunk) => {
      for (const line of chunk.split('\n')) {
        if (!line.includes('server_listening')) continue;
        const record = JSON.parse(line);
        clearTimeout(timeout);
        resolve(record.port);
      }
    };
    child.stdout.on('data', inspect);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`server exited before listening: code=${code} signal=${signal} stderr=${stderr}`));
    });
  });
  return { child, listening, stdout: () => stdout, stderr: () => stderr };
}

async function stop(child, signal) {
  const exited = once(child, 'exit');
  child.kill(signal);
  const [code, actualSignal] = await exited;
  return { code, signal: actualSignal };
}

async function create(base) {
  const response = await fetch(`${base}/v1/links`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify({ targetUrl }),
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`create failed with ${response.status}: ${await response.text()}`);
  }
  return { status: response.status, body: await response.json() };
}

const pool = new Pool({ connectionString: databaseUrl });
await new PostgresLinkStore(pool).migrate();
await pool.query('TRUNCATE redirect_events, short_links');
const version = await pool.query('SHOW server_version');

const first = startServer();
const firstPort = await first.listening;
const firstBase = `http://127.0.0.1:${firstPort}`;
const allocation = await create(firstBase);
assert.equal(allocation.status, 201);
const redirect = await fetch(`${firstBase}/r/${allocation.body.code}`, { redirect: 'manual' });
assert.equal(redirect.status, 302);
assert.equal(redirect.headers.get('location'), targetUrl);
const killed = await stop(first.child, 'SIGKILL');
assert.equal(killed.signal, 'SIGKILL');

const second = startServer();
const secondPort = await second.listening;
const secondBase = `http://127.0.0.1:${secondPort}`;
const replay = await create(secondBase);
assert.equal(replay.status, 200);
assert.equal(replay.body.code, allocation.body.code);
const redirectAfterRestart = await fetch(`${secondBase}/r/${allocation.body.code}`, { redirect: 'manual' });
assert.equal(redirectAfterRestart.status, 302);
const graceful = await stop(second.child, 'SIGTERM');
assert.equal(graceful.code, 0);

const rows = await pool.query('SELECT count(*)::integer AS count FROM short_links');
const events = await pool.query(
  'SELECT count(*)::integer AS count FROM redirect_events WHERE code = $1',
  [allocation.body.code],
);
assert.equal(rows.rows[0].count, 1);
assert.equal(events.rows[0].count, 2);

const logs = `${first.stdout()}${first.stderr()}${second.stdout()}${second.stderr()}`;
for (const secret of [token, idempotencyKey, targetUrl, allocation.body.code]) {
  assert.ok(!logs.includes(secret), 'runtime logs contained request or mapping identity');
}
await pool.end();

process.stdout.write(`${JSON.stringify({
  kind: 'postgres_crash_recovery_receipt',
  node: process.version,
  postgres: version.rows[0].server_version,
  mappingCount: 1,
  redirectAttemptCount: 2,
  forcedTermination: 'SIGKILL',
  idempotentReplayAfterRestart: true,
  redirectAfterRestart: true,
  gracefulSuccessorShutdown: true,
  requestIdentityLogged: false,
  mappingIdentityLogged: false,
  claimBoundary: 'one PostgreSQL service and two sequential application processes; not database failover, power-loss, multi-region, or destination-arrival proof',
})}\n`);
