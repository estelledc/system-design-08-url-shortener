# Operations runbook

## Start and readiness

1. Provision a PostgreSQL database and a least-privilege application role. The demo Compose password is local-only.
2. Supply `DATABASE_URL`, `AUTH_TOKENS_JSON`, and the externally correct `PUBLIC_BASE_URL` through the runtime secret/configuration system.
3. Start one process. Startup applies the idempotent schema and binds loopback.
4. Check `/health/live`, then `/health/ready`. Only readiness proves that the process completed a PostgreSQL query.
5. Keep `/metrics` and health endpoints on a private operator plane.

## Alerts worth defining

- create or redirect `5xx` rate and PostgreSQL pool acquisition latency;
- generated-code collision and allocation-exhaustion count;
- idempotency conflict rate;
- database connection saturation, lock waits, storage growth, replica lag, and backup age;
- redirect-event growth and retention-job lag;
- abuse reports, destination-block decisions, and takedown latency.

The v0.1 metrics endpoint only exposes aggregate process counters. Database and abuse signals need external instrumentation.

## Storage outage

- Readiness becomes unavailable.
- Creation, management, and redirect return `503`; do not substitute the request's target or a stale unversioned value.
- Stop automated retries that amplify database saturation. Clients can retry exact creation intent with the same idempotency key after recovery.
- Verify the database and schema before re-enabling traffic.

## Process crash

PostgreSQL owns committed state. Restart the application with the same database and auth identity mapping. Replaying the same owner/key/payload must return the prior code. `npm run smoke:postgres` exercises create, redirect, application `SIGKILL`, restart, stable replay, another redirect, and graceful successor shutdown.

That smoke does not kill PostgreSQL, cut power, test WAL/device durability, restore a backup, or fail over to a replica.

## Deactivation incident

1. Authenticate the owning principal and read current metadata/ETag.
2. Submit `DELETE` with the exact `If-Match` version.
3. Verify management state is `deactivated` and the public path returns `410`.
4. Do not delete the row or reuse the code. Existing caches are outside v0.1; a future cached deployment must separately prove invalidation bounds.

## Collision anomaly

A small number of primary-key collisions is expected probabilistically at scale and is handled by retry. A sustained increase can indicate namespace occupancy, generator failure, a deterministic injection mistake, or an attack. Preserve counts and runtime metadata, stop if the 12-attempt exhaustion path appears, and do not silently increase retry loops before understanding the cause.

## Backup and restore

No backup procedure has been validated by this repository. Before production use, define recovery-point and recovery-time objectives, back up both tables and schema, restore into an isolated environment, verify owner/request uniqueness and code tombstones, and reconcile redirect-event retention. A successful application restart is not a backup receipt.
