# Repository instructions

- Preserve the link invariants: a code is never reassigned, one owner/idempotency key has one immutable request payload, and redirects never use an unvalidated request parameter directly.
- PostgreSQL constraints are part of the correctness boundary; memory-store tests do not substitute for the real PostgreSQL gate.
- A redirect event means the service durably accepted a redirect attempt before responding. It does not prove that a browser reached the destination.
- Never log bearer tokens, idempotency keys, target URLs, short codes, or event IDs.
- Do not claim the local benchmark, one database service, or green CI as production scale, multi-region availability, abuse prevention, or deployment evidence.
