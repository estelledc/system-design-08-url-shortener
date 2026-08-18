# Verification record

## Gates

`npm run check` executes:

1. syntax, portable-path, local-link, secret-pattern, required-artifact, skipped-test, and pinned-Action checks;
2. deterministic unit and in-memory HTTP tests;
3. a 50,000-operation in-memory decision-path benchmark with an explicit 5,000 operations/s floor;
4. `npm audit --audit-level=high`.

`npm run check:ci` additionally executes real PostgreSQL integration tests and a child-process crash/restart smoke. CI supplies PostgreSQL 17.6 separately on Node 22, 24, and 26. The local gate does not report the PostgreSQL suite as skipped when no database is present; it is a distinct required publication gate.

## Tested behaviors

- exact Base62 capacity arithmetic, encoding boundaries, code shape, and invalid entropy adapter;
- target parsing, normalization, scheme/userinfo/loop/size rejection;
- exact idempotent replay, payload conflict, same-target distinct intent, generated collision retry, custom alias conflict, and bounded exhaustion;
- 32-way duplicate concurrency in memory and under real PostgreSQL constraints;
- owner authorization, versioned deactivation, permanent tombstone, expiry, GET event, and HEAD non-event;
- HTTP auth/body/header/error/redirect/cache behavior and low-identity structured logs;
- mapping and event persistence across application `SIGKILL` and a new process;
- dependency audit and pinned GitHub Actions.

No test in either invoked suite is skipped.

## Current receipts

The initial public CI receipt is pending repository publication. Replace this sentence only after the GitHub run is green.

## Evidence boundary

The gates support only the behavior and environments listed above. They do not prove:

- random-code unpredictability against a determined attacker or entropy failure monitoring;
- destination reputation, phishing/malware prevention, tenant lifecycle, quotas, public rate limiting, or takedown operations;
- cache invalidation, message-queue delivery, exactly-once analytics, or destination arrival;
- database power-loss durability, backup/restore, replication, failover, sharding, or multi-region convergence;
- exercise-scale storage/throughput, production deployment, SLA, or external acceptance.

## Reproduce

```sh
npm ci --ignore-scripts
npm run check
docker compose up -d --wait
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/url_shortener npm run test:postgres
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/url_shortener npm run smoke:postgres
docker compose down
```

Benchmark output records runtime, platform, operation count, elapsed time, rate, explicit floor, and claim boundary. Its deterministic in-memory codes intentionally isolate service decision overhead; it excludes the production random generator and every external-system cost.
