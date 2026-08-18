# Security policy

Report a vulnerability through GitHub's private security-advisory flow. Do not put live bearer tokens, target URLs, idempotency keys, short codes, database connection strings, or redirect-event data in a public issue.

## Supported scope

The current `main` branch is the supported learning baseline. It validates absolute HTTP(S) targets, rejects embedded URL credentials and service-loop hostnames, authenticates management calls with a static bearer map, uses parameterized PostgreSQL statements, bounds request bodies and code-allocation retries, and omits request/mapping identity from application logs.

These controls do not make a public URL shortener safe to operate. The project has no destination reputation feed, malware scanning, phishing interstitial, tenant quota, distributed rate limit, token rotation, TLS termination, secret manager, WAF, takedown workflow, legal process, or incident service. A short code is public metadata, not an access-control secret.
