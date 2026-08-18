# System Design 08: URL Shortener

This repository is an executable, evidence-first URL-shortener slice. It allocates case-sensitive short codes, preserves immutable creation intent through an owner-scoped idempotency key, redirects active links, records a durable redirect-attempt receipt, and tombstones deactivated codes so they cannot be hijacked later.

It is deliberately smaller than a production service. One PostgreSQL service is enough to test the hard state transitions; it is not evidence of sharding, database failover, multi-region availability, destination safety, or internet-scale traffic.

## The behavior contract

1. An authenticated owner submits a target URL and an `Idempotency-Key`.
2. The same owner/key/payload returns the same allocation after concurrency or process restart.
3. Reusing the key with a different target, expiry, or custom code is rejected.
4. A generated code is eight cryptographically random Base62 characters. PostgreSQL's primary key is the final uniqueness authority; collisions are retried at most 12 times.
5. A public `GET /r/:code` commits a redirect-attempt event before returning `302`. `HEAD` resolves without counting an attempt.
6. Expired or deactivated links return `410`. Their codes remain reserved forever in this model.

The strongest invariant is not “hashes rarely collide.” It is:

> No response exposes a new short link until the mapping and its immutable request identity have committed under database uniqueness constraints.

## Requirements and explicit assumptions

The following learning workload is an assumption used for arithmetic, not observed traffic:

| Input | Assumption | Derived average | 10x planning peak |
|---|---:|---:|---:|
| New links | 100 million/day | about 1,157 writes/s | about 11,574 writes/s |
| Redirect:create ratio | 10:1 | about 11,574 reads/s | about 115,741 reads/s |
| Retention | 10 years | 365 billion mappings | — |

If a mapping plus its share of indexes averages 672 bytes, 365 billion mappings are about 245 TB decimal before replication, backups, table bloat, and storage-engine overhead. Three copies would be about 736 TB before those additions. This repository neither provisions nor benchmarks that capacity.

`62^7 = 3,521,614,606,208`, but capacity alone hides collision pressure: 365 billion rows would occupy about 10.4% of a uniform seven-character random space. `62^8 = 218,340,105,584,896`, reducing that target occupancy to about 0.167%. The database constraint still decides uniqueness; random-space arithmetic is not a proof.

## Why this implementation differs from the common sketch

- It does not globally deduplicate by long URL. The same destination can represent different owners, expiries, campaigns, or moderation decisions. Only owner plus idempotency key identifies one creation intent.
- It does not derive public codes from a monotonic database ID. That approach is collision-free but reveals issuance order and volume, and it couples this service to a globally coordinated ID path.
- It does not add a cache to a path that still performs a synchronous analytics write. In this slice, the database stays on the critical path by design. [The scale-out design](docs/architecture.md) describes the later cache/outbox split and its stale-read cost.
- It does not treat a short code as authorization. Eight Base62 characters carry about 47.6 bits of namespace, but links are enumerable public references and can point to harmful destinations.

## Minimal architecture

```mermaid
flowchart LR
  Owner[Authenticated owner] --> API[HTTP API]
  Visitor[Visitor GET] --> API
  API --> Policy[URL and request policy]
  Policy --> Service[Link state machine]
  Service --> PG[(PostgreSQL 17)]
  PG --> Links[short_links]
  PG --> Events[redirect_events]
  API -->|302 after commit| Destination[Stored target]
```

PostgreSQL enforces unique `code` and unique `(owner_id, request_key)`. Creation uses `INSERT ... ON CONFLICT DO NOTHING RETURNING`: an inserted row is new; otherwise a second statement distinguishes request replay from code collision. The official PostgreSQL documentation defines both [unique constraints](https://www.postgresql.org/docs/17/ddl-constraints.html#DDL-CONSTRAINTS-UNIQUE-CONSTRAINTS) and [`ON CONFLICT`](https://www.postgresql.org/docs/17/sql-insert.html#SQL-ON-CONFLICT).

Targets pass the platform's WHATWG URL parser and must be absolute HTTP(S) URLs without embedded credentials or service-loop hostnames. This is syntax and local policy, not malware or phishing classification. See the [WHATWG URL Standard](https://url.spec.whatwg.org/) and [OWASP redirect guidance](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html).

The service emits `302` plus `Cache-Control: no-store`. RFC 9110 distinguishes [permanent 301 redirects](https://www.rfc-editor.org/rfc/rfc9110.html#name-301-moved-permanently), which are heuristically cacheable, from [temporary 302 redirects](https://www.rfc-editor.org/rfc/rfc9110.html#name-302-found). A 302 attempt receipt still does not prove the user agent followed the redirect or reached the destination.

## Run locally

Node.js 22 or newer is required.

```sh
npm ci --ignore-scripts
npm run check
```

That local gate runs static checks, unit/HTTP tests, a bounded in-memory decision benchmark, and dependency audit. It does not silently skip database integration.

For the real PostgreSQL path, start the disposable local service and run the additional gate:

```sh
docker compose up -d --wait
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/url_shortener npm run test:postgres
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/url_shortener npm run smoke:postgres
docker compose down
```

CI runs `npm run check:ci` against a real PostgreSQL 17.6 service on Node 22, 24, and 26. No database test is replaced by an in-memory fake in that receipt.

To start the demo service, provide database and bearer configuration outside Git:

```sh
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/url_shortener \
AUTH_TOKENS_JSON='[{"token":"replace-with-at-least-16-characters","ownerId":"demo-owner"}]' \
PUBLIC_BASE_URL=https://short.example \
npm start
```

The static bearer map exists only to make the trust boundary executable. It has no rotation, federation, account lifecycle, or production secret-management claim.

## Repository map

- [API contract](docs/api.md)
- [Architecture, state, failure windows, and scale-out path](docs/architecture.md)
- [ADR: random codes and durable creation intent](docs/adr/0001-random-code-and-durable-intent.md)
- [Threat model](docs/threat-model.md)
- [Operations](docs/operations.md)
- [Verification record](docs/verification.md)
- `src/link-service.js`: policy and allocation state machine
- `src/postgres-store.js`: real constraints and transaction boundaries
- `scripts/postgres-smoke.mjs`: create, redirect, `SIGKILL`, restart, replay, and durable-event receipt

## Evidence boundary

Passing the current gates supports the tested code allocation, idempotency, collision, redirect-attempt, expiry, deactivation, process-restart, HTTP, and log-redaction behavior. It does not establish destination reputation, abuse moderation, public authentication, rate limits, cache correctness, queue delivery, database backup/restore, PostgreSQL failover, sharding, multi-region convergence, load capacity, deployment, SLA, or external acceptance.

The problem taxonomy was prompted by a fixed snapshot of `liquidslr/system-design-notes`. That tree had no detected license, so this repository copies no prose, diagrams, or code from it. Design details were independently derived and checked against the primary specifications linked above.

## License

[MIT](LICENSE)
