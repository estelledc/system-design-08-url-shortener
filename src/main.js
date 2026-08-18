import { Pool } from 'pg';
import { StaticBearerAuthenticator } from './auth.js';
import { createHttpServer } from './http-server.js';
import { LinkService } from './link-service.js';
import { PostgresLinkStore } from './postgres-store.js';

const databaseUrl = process.env.DATABASE_URL;
const authJson = process.env.AUTH_TOKENS_JSON;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!authJson) throw new Error('AUTH_TOKENS_JSON is required');

const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT is invalid');
const poolSize = Number(process.env.DB_POOL_SIZE ?? 10);
if (!Number.isInteger(poolSize) || poolSize < 1 || poolSize > 100) throw new Error('DB_POOL_SIZE is invalid');

const pool = new Pool({
  connectionString: databaseUrl,
  max: poolSize,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  application_name: 'system-design-08-url-shortener',
});
const store = new PostgresLinkStore(pool);
await store.migrate();

const service = new LinkService({
  store,
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:8080',
});
const authenticator = StaticBearerAuthenticator.fromJson(authJson);
const logger = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const server = createHttpServer({ service, authenticator, logger });

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  logger({ kind: 'server_listening', host: '127.0.0.1', port: address.port });
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger({ kind: 'shutdown_started', signal });
  server.close(async (error) => {
    await store.close().catch(() => {});
    if (error) process.exitCode = 1;
    logger({ kind: 'shutdown_completed', ok: !error });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
