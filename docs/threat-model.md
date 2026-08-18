# Threat model

## Assets and trust boundaries

- Assets: owner-to-link authority, immutable creation intent, target mapping, availability, redirect-attempt records, bearer credentials, and database access.
- Untrusted: all HTTP headers/bodies, target URLs, custom codes, public redirect callers, and destinations.
- Trusted only for the executable slice: loopback listener, configured bearer-to-owner map, PostgreSQL connection, runtime entropy source, and host clock.

| Threat | Failure | Implemented control | Required production control |
|---|---|---|---|
| Code collision | Wrong target or overwrite | Primary key plus bounded retry | Monitor collision rate and RNG health |
| Concurrent request retry | Duplicate mappings | Unique owner/key constraint and payload digest | Stable auth identity across regions |
| Idempotency-key reuse | Silent intent mutation | Digest mismatch returns `409` | Retention and privacy policy for request identity |
| Alias takeover after deletion | Old links point to a new owner | Permanent tombstone | Formal retention/reclamation policy if reuse is required |
| Script or local-file target | Browser executes unsafe scheme | Absolute HTTP(S)-only parser | Destination reputation and takedown system |
| Embedded credentials or redirect loop | Deceptive URL or recursion | Reject URL userinfo and configured service hostname | Canonical domain inventory across all edges |
| Phishing or malware destination | Trusted short domain aids abuse | Explicitly not solved | Reputation feeds, scanning, interstitials, reports, moderation |
| Enumeration | Private target disclosure | Random eight-character default | Treat codes as public; add separate access token for private links |
| Credential theft | Link management takeover | Credential digest comparison; no auth logs | TLS, secret manager, rotation, revocation, federation |
| SQL injection | Data disclosure or mutation | Parameterized statements | Least-privilege DB role and database audit |
| Analytics privacy leak | Behavioral tracking | Store only code and event time; no IP/referrer/user agent | Retention, aggregation, consent, access governance |
| Dependency outage | Unsafe stale redirect | Fail closed with `503` | Replication, failover, capacity and recovery exercises |
| Resource exhaustion | Memory/DB pressure | Body, URL, alias, retry, and pool bounds | Auth quotas, distributed rate limits, WAF and admission control |
| Log disclosure | Targets or credentials copied to telemetry | Route-level low-cardinality logs | Central redaction tests and restricted log access |

The service is intentionally a redirector, so generic “never redirect to user input” advice does not fit the product. The relevant boundary is that a redirect can only use a previously validated, server-side mapping; the public GET cannot supply an arbitrary `url=` destination.
