import http from 'node:http';
import { AppError, ValidationError } from './errors.js';

const MAX_BODY_BYTES = 16 * 1024;

function writeJson(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(payload);
}

async function readJson(request) {
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ValidationError('Content-Type must be application/json');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ValidationError('request body is too large');
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch {
    throw new ValidationError('request body must be a JSON object');
  }
}

function routeCode(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  const suffix = pathname.slice(prefix.length);
  if (!suffix || suffix.includes('/')) return null;
  try {
    return decodeURIComponent(suffix);
  } catch {
    throw new ValidationError('short code path encoding is invalid');
  }
}

function parseIfMatch(value) {
  if (typeof value !== 'string') throw new ValidationError('If-Match is required');
  const match = /^"?([1-9][0-9]*)"?$/.exec(value);
  if (!match) throw new ValidationError('If-Match must contain a positive integer link version');
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version)) throw new ValidationError('If-Match version is too large');
  return version;
}

function metricText(metrics) {
  return [
    '# TYPE url_shortener_requests_total counter',
    `url_shortener_requests_total ${metrics.requests}`,
    '# TYPE url_shortener_errors_total counter',
    `url_shortener_errors_total ${metrics.errors}`,
    '# TYPE url_shortener_redirects_total counter',
    `url_shortener_redirects_total ${metrics.redirects}`,
    '# TYPE url_shortener_links_created_total counter',
    `url_shortener_links_created_total ${metrics.created}`,
    '',
  ].join('\n');
}

export function createHttpServer({ service, authenticator, logger = () => {} }) {
  if (!service || !authenticator) throw new TypeError('service and authenticator are required');
  const metrics = { requests: 0, errors: 0, redirects: 0, created: 0 };

  return http.createServer(async (request, response) => {
    metrics.requests += 1;
    let route = 'unknown';
    let status = 500;
    try {
      const url = new URL(request.url, 'http://service.local');

      if (request.method === 'GET' && url.pathname === '/health/live') {
        route = 'health_live';
        status = 200;
        return writeJson(response, status, { status: 'live' });
      }
      if (request.method === 'GET' && url.pathname === '/health/ready') {
        route = 'health_ready';
        await service.ready();
        status = 200;
        return writeJson(response, status, { status: 'ready' });
      }
      if (request.method === 'GET' && url.pathname === '/metrics') {
        route = 'metrics';
        const body = metricText(metrics);
        status = 200;
        response.writeHead(status, {
          'cache-control': 'no-store',
          'content-type': 'text/plain; version=0.0.4; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          'x-content-type-options': 'nosniff',
        });
        return response.end(body);
      }
      if (request.method === 'POST' && url.pathname === '/v1/links') {
        route = 'create_link';
        const ownerId = authenticator.authenticate(request.headers.authorization);
        const body = await readJson(request);
        const result = await service.createLink({
          ownerId,
          idempotencyKey: request.headers['idempotency-key'],
          targetUrl: body.targetUrl,
          expiresAt: body.expiresAt,
          customCode: body.customCode,
        });
        if (result.created) metrics.created += 1;
        status = result.created ? 201 : 200;
        return writeJson(response, status, result.link, {
          etag: `"${result.link.version}"`,
          location: `/v1/links/${encodeURIComponent(result.link.code)}`,
        });
      }

      const managementCode = routeCode(url.pathname, '/v1/links/');
      if (managementCode !== null && request.method === 'GET') {
        route = 'get_link';
        const ownerId = authenticator.authenticate(request.headers.authorization);
        const link = await service.getLink(managementCode, ownerId);
        status = 200;
        return writeJson(response, status, link, { etag: `"${link.version}"` });
      }
      if (managementCode !== null && request.method === 'DELETE') {
        route = 'deactivate_link';
        const ownerId = authenticator.authenticate(request.headers.authorization);
        const link = await service.deactivate(managementCode, {
          ownerId,
          expectedVersion: parseIfMatch(request.headers['if-match']),
        });
        status = 200;
        return writeJson(response, status, link, { etag: `"${link.version}"` });
      }

      const redirectCode = routeCode(url.pathname, '/r/');
      if (redirectCode !== null && (request.method === 'GET' || request.method === 'HEAD')) {
        route = request.method === 'HEAD' ? 'resolve_head' : 'resolve_get';
        const resolved = await service.resolve(redirectCode, { recordEvent: request.method === 'GET' });
        if (request.method === 'GET') metrics.redirects += 1;
        status = 302;
        response.writeHead(status, {
          'cache-control': 'no-store',
          location: resolved.targetUrl,
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
        });
        return response.end();
      }

      status = 404;
      return writeJson(response, status, { error: { code: 'not_found', message: 'route was not found' } });
    } catch (error) {
      metrics.errors += 1;
      const appError = error instanceof AppError
        ? error
        : new AppError('internal server error', { expose: false });
      status = appError.status;
      if (status === 401) response.setHeader('www-authenticate', 'Bearer');
      writeJson(response, status, {
        error: {
          code: appError.code,
          message: appError.expose ? appError.message : 'internal server error',
        },
      });
    } finally {
      logger({ kind: 'http_request', route, method: request.method, status });
    }
  });
}
