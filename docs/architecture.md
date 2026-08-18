# Architecture and correctness model

## State model

Each code has one permanent row identity:

```text
unallocated --create commit--> active --deactivate commit--> deactivated
                                  |
                                  +--clock reaches expiry--> logically expired
```

Expired is computed from the stored instant and request-time clock; it does not delete or free the row. Deactivation is an explicit versioned state transition. There is no transition back to active and no code reassignment.

Creation intent has a separate invariant:

```text
(owner, request key) -> SHA-256(normalized target, expiry, custom code) -> one code
```

The digest detects a different retry payload. It is not authentication and does not hide a low-entropy target from someone who can read the database.

## Create path

1. Authenticate the owner and validate request/body bounds.
2. Parse and serialize the target with the WHATWG URL implementation; allow only HTTP(S), no embedded credentials, no configured service-loop hostname.
3. Normalize expiry and custom code, then compute the immutable request digest.
4. Read an existing owner/request allocation for the fast replay path.
5. Generate an eight-character candidate, or use the validated custom code.
6. `INSERT ... ON CONFLICT DO NOTHING RETURNING`. A returned row is the newly committed mapping.
7. If nothing was inserted, a new statement reads `(owner_id, request_key)`. An exact digest is replay, a mismatch is `409`, and no request row means the code collided. Generated codes retry up to 12 total attempts; a custom-code collision is immediately `409`.
8. Return only after the database statement commits.

The preliminary read is an optimization, not the concurrency guard. Two callers can both miss it; the database unique constraint still converges them.

## Redirect path

`GET /r/:code` opens one database transaction, selects the mapping `FOR SHARE`, checks state/expiry, inserts one event, and commits before returning `302`. Deactivation takes a row update lock. Therefore a successful redirect transaction is ordered before or after a competing deactivation; it does not observe a half-transition.

This choice gives a durable accepted-attempt receipt and a simple failure rule: if storage is unavailable, return `503`. It also makes PostgreSQL write latency part of every counted redirect. The event can overcount successful browser journeys because a response can be lost after commit, and retries get new event IDs.

`HEAD` uses the active lookup but deliberately writes no event. It is suitable for health checks, not click simulation.

## Data model

`short_links`:

- `code` primary key, never updated;
- owner/request unique constraint and immutable request digest;
- exact normalized target;
- create/expiry/deactivation epoch milliseconds;
- active/deactivated state and optimistic management version;

`redirect_events`:

- random event UUID primary key;
- foreign key to the permanent code row;
- accepted-attempt timestamp;
- no IP address, referrer, user agent, owner, or target duplication.

## Failure windows

| Window | Observable result | Retry behavior |
|---|---|---|
| Process dies before create commit | No mapping | Same owner/key can create normally |
| Process dies after commit before response | Mapping exists, caller saw failure | Same owner/key/payload returns the same code |
| Random candidate already exists | Primary-key violation | Generated codes retry; custom code returns conflict |
| Process dies before redirect event commit | No 302 and no committed event | Retry performs a new attempt |
| Process dies after event commit before 302 | Event exists, client may see failure | Retry adds another event; downstream aggregation must accept overcount |
| Deactivation races redirect | Row locks serialize transactions | Redirect is wholly before or after deactivation |
| Database unavailable | Readiness and link operations fail | Service returns `503`; it does not redirect from an unverified stale value |

## Why v0.1 has no cache

The synchronous event insert keeps PostgreSQL on every counted GET. Caching only the target would add stale deactivation/expiry behavior without removing the database write from the critical path. That is not a useful complexity trade in the executable slice.

At the assumed 10:1 read ratio, a scalable evolution would separate two contracts:

1. read-through mapping cache or CDN for redirect latency, with versioned invalidation and an explicit maximum stale window;
2. append-only click transport/outbox with at-least-once delivery, idempotent aggregation, privacy retention, and backpressure.

That evolution changes the evidence: a cached redirect may proceed while analytics is delayed, and cross-instance deactivation needs invalidation or bounded staleness. None of those capabilities are claimed by the current code.

## Scale-out sketch, not current capability

- Partition mappings by a stable hash of `code`; keep the owner/request index routed by owner or in a dedicated intent service.
- Reserve custom aliases through the same authoritative partition as generated codes.
- Replicate read data and define whether redirects can tolerate replica lag after deactivation.
- Put analytics on a partitioned durable log, not the mapping transaction, only after loss/duplicate semantics and overload policy are explicit.
- Isolate health/metrics on an operator plane; add real authentication, quotas, destination moderation, and takedown flows.
- Prove backup/restore and failover with real PostgreSQL topology before calling the storage highly available.

The repository's one-service PostgreSQL CI exercises SQL behavior, not this scale-out design.
