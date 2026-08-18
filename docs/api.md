# API contract

All JSON responses use `Cache-Control: no-store`. Management endpoints require `Authorization: Bearer ...`; the demo authenticator maps a credential to an internal owner identity. Tokens, owner identities, targets, idempotency keys, codes, and event IDs are excluded from structured request logs.

## Create a link

`POST /v1/links`

Required headers:

```text
Authorization: Bearer <credential>
Content-Type: application/json
Idempotency-Key: <8-128 visible ASCII characters>
```

Body:

```json
{
  "targetUrl": "https://example.com/article?q=1",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "customCode": "release-notes"
}
```

`expiresAt` and `customCode` are optional. Expiry must be in the future and at most ten years away. Custom codes contain 4-32 ASCII letters, digits, hyphens, or underscores and are case-sensitive.

- `201 Created`: the mapping committed for the first time.
- `200 OK`: the exact owner/key/payload was already committed.
- `409 idempotency_conflict`: that owner/key belongs to a different immutable payload.
- `409 alias_conflict`: a requested custom code is already reserved, including by a deactivated link.
- `503 allocation_unavailable`: every generated candidate in the bounded retry budget collided.

Response:

```json
{
  "code": "release-notes",
  "shortUrl": "https://short.example/r/release-notes",
  "targetUrl": "https://example.com/article?q=1",
  "createdAt": "2026-08-18T00:00:00.000Z",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "state": "active",
  "version": 1
}
```

`ETag: "1"` exposes the management version. `Location` points to the management resource, not the redirect target.

## Resolve a link

`GET /r/:code` returns `302 Found`, the stored target in `Location`, `Cache-Control: no-store`, and `Referrer-Policy: no-referrer`. Before the response is written, a PostgreSQL transaction verifies that the mapping is active and commits one redirect-attempt event.

`HEAD /r/:code` performs the same active lookup and returns the same redirect headers without writing an event. Monitoring should use `HEAD`; using `GET` changes analytics state.

- `404`: the code was never allocated.
- `410`: the mapping expired or was deactivated.
- `503`: storage could not verify the mapping or commit the required attempt receipt.

An event is an accepted attempt at the redirect service. Network loss after commit can leave an event without a delivered 302; a client retry creates another event. The event is neither exactly-once click analytics nor destination-arrival proof.

## Read owner metadata

`GET /v1/links/:code` requires the owning bearer identity and returns the creation representation with the current `ETag`.

## Deactivate

`DELETE /v1/links/:code` requires the owner plus `If-Match: "<version>"`. A matching active link becomes `deactivated`, increments its version, and remains reserved.

- `403`: authenticated principal is not the owner.
- `412`: version does not match.
- `200`: deactivation committed, or the same owner/version already describes the deactivated state.

## Health and metrics

- `GET /health/live`: process handler is alive; it does not touch storage.
- `GET /health/ready`: PostgreSQL accepted a query.
- `GET /metrics`: low-cardinality process counters only. It has no code, owner, target, or status label that can grow without bound.

These operator endpoints have no network-plane authorization in v0.1 and must remain loopback/private behind infrastructure controls.
