# #56 affected PWA Cloud GET compatibility fallback

> **Superseded (2026-09-17):** This report records an intermediate diagnosis that was later disproved as the root cause. The actual #56 failure was a historical `cloudUrl` value that omitted `/api/prompt-vault`. The path-less value came from the original user-facing connection design; it was not a user mistake. PR #64 made the Cloud endpoint product-owned and normalized historical values. PR #66 then removed the query-token compatibility fallback described below. Treat the remainder of this file as historical investigation notes only.

## Confirmed runtime evidence (2026-09-17)

Read-only production diagnostics reported in #56 established:

- production Worker revision matches `ai-family-foundation` current main deployment;
- `AUTH_TOKEN` exists in production;
- OPTIONS for `/api/prompt-vault/cards` and `/gallery/recent` returns 204 with the expected CORS headers;
- authenticated GET `/cards` and `/gallery/recent` returns 200 from an independent client and reaches Worker with `outcome: ok`;
- the existing `?token=` authentication path also returns 200;
- the affected installed PWA still reported Fetch API `TypeError: Failed to fetch` while its stored `cloudUrl` pointed at the Worker root rather than the Prompt Vault API base.

These observations ruled out the production Worker as the source of the failure, but they did **not** establish a browser/PWA Authorization bug. The later `cloudUrl` finding explains the affected PWA behavior without requiring that hypothesis.

## Historical compatibility change

A temporary compatibility fallback retried a failed Bearer GET using the already-supported `?token=` path. This was merged during diagnosis and later removed by PR #66 after the root cause was corrected.

The temporary retry was:

- limited to the configured HTTPS `cloudUrl` origin/path;
- GET-only;
- not used for HTTP 401/403/404/5xx;
- not used for AbortError or an aborted signal;
- stripped `Authorization` and `Content-Type`;
- used `cache: no-store`, `credentials: omit`, and `referrerPolicy: no-referrer`;
- not applied to POST/PUT/DELETE.

## Final resolution

- PR #64: canonical `CLOUD_URL` is product-owned, historical stored values are normalized, and Cloud URL is no longer user-editable.
- PR #66: authenticated `/settings` Cloud probe restored; `cloudOfflineReason` diagnostics restored; temporary query-token fallback removed.
- #61: closed because the query-token fallback and its long-lived-token URL exposure risk were removed.

Design rule: infrastructure endpoint identity that the application can provide must not be delegated to normal user input. Environment-specific overrides belong in application/build/runtime configuration, not ordinary user settings.
