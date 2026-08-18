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

- Implementation commit: [`3f77f05b139f939e806495042c89fb074646bee8`](https://github.com/estelledc/system-design-08-url-shortener/commit/3f77f05b139f939e806495042c89fb074646bee8).
- Public CI: [run 32154593404](https://github.com/estelledc/system-design-08-url-shortener/actions/runs/32154593404), completed successfully on 2026-08-18.
- Node `22.23.2`, `24.19.0`, and `26.7.0` each reported 19 unit/HTTP tests plus 5 real PostgreSQL tests passed, 0 failed, and 0 skipped. Each job used PostgreSQL `17.6` and reported 0 dependency vulnerabilities.
- Every job completed the process receipt: one mapping committed, one redirect attempt committed, the application was terminated with `SIGKILL`, the same owner/key/payload replayed the same code in a new process, a second redirect succeeded and committed, and the successor shut down gracefully. The final database counts were one mapping and two attempt events.
- The 50,000-operation deterministic in-memory benchmark cleared its explicit 5,000 operations/s floor on all runners. Observed Linux rates were about 125,000-132,000 operations/s; they are not PostgreSQL, HTTP, random-code, or production-capacity measurements.

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
