# ADR 0001: random codes with durable creation intent

- Status: accepted
- Date: 2026-08-18

## Context

A shortener needs compact public identifiers, safe retry behavior, and a rule for concurrent allocation. Three tempting shortcuts are insufficient:

1. Truncating a hash of the target makes collisions and mutable normalization policy part of identity.
2. Encoding a monotonic database ID removes collisions but leaks issuance order and volume, and adds a shared allocator dependency.
3. Looking up the long URL before insertion does not identify business intent and races under concurrency.

Seven Base62 characters provide about 3.52 trillion values. Under the exercise's 365-billion-row assumption, a uniform random namespace would already be about 10.4% occupied. “The namespace is larger than the row count” is not an adequate collision argument.

## Decision

- Generate eight Base62 characters using Node's cryptographic [`randomInt`](https://nodejs.org/api/crypto.html#cryptorandomintmin-max-callback), whose documented implementation avoids modulo bias.
- Make the PostgreSQL primary key on `code` the uniqueness authority.
- Retry generated-code primary-key collisions at most 12 times; never retry a custom alias behind the user's back.
- Define creation identity as `(owner_id, request_key)` and store a SHA-256 digest of normalized target, expiry, and requested custom code.
- Use PostgreSQL `ON CONFLICT DO NOTHING RETURNING`; after any conflict, read the owner/request row to distinguish exact replay, payload conflict, and code collision.
- Keep deactivated rows. Codes are never reassigned in this version.

## Consequences

- Normal creation does not require a global numeric sequence and does not expose a simple issuance counter.
- A database round trip and index contention remain on the write path.
- Uniform-random occupancy math depends on the runtime generator and still cannot replace the primary-key constraint.
- The stored SHA-256 value is an equality digest, not a MAC, authorization proof, or reversible payload record.
- Tombstones consume namespace and storage indefinitely; safe code reuse would require a separate product and security decision.
- Custom aliases are easier to enumerate and impersonate. Authentication proves who may manage a mapping, not whether the destination is reputable.

## Rejected alternatives

- **Target hash plus recursive salt:** collision policy and URL normalization become identity; adversarial and retry behavior are harder to explain.
- **Seven random characters:** mathematically sufficient total capacity for the exercise but unnecessarily high target occupancy.
- **Sequential Base62 ID:** valid for other requirements, but couples allocation to a shared ordered ID service and exposes ordering.
- **Global target deduplication:** conflates tenants, expiries, campaigns, and moderation decisions; may reveal whether another caller already shortened a target.
