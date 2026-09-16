# #56 Cloud GET fallback

## Problem

On the affected Android PWA, Cloud is selected but authenticated GET requests such as `/cards` and `/presets` reject at the Fetch API level (`Failed to fetch`). The Worker already supports both Bearer auth and `?token=` auth.

## Change

Bearer remains the primary authentication path. A global fetch compatibility layer retries only when all of the following are true:

- the primary `fetch()` rejected before exposing an HTTP response;
- method is `GET`;
- URL is under `/api/prompt-vault`;
- an `Authorization: Bearer ...` header was present.

The retry removes `Authorization`, moves the same token to the existing `?token=` auth path, sets `cache: no-store`, and uses `referrerPolicy: no-referrer`.

HTTP 401/403/404/5xx responses are **not** retried, so normal API/auth errors keep their current semantics.

## Security boundary

This is a compatibility fallback, not the normal transport. Query-token auth is already accepted by the production Worker middleware. The fallback is restricted to idempotent GET requests and only activates after a transport/CORS-class rejection. POST/PUT/DELETE continue to use Bearer auth only.

## Remaining runtime verification

After deployment to the affected PWA, verify Fran-off -> automatic Cloud selection -> `/settings`, `/cards`, `/presets`, `/gallery`, `/gallery/recent` and image GETs. If the retry itself also reports `Failed to fetch`, the failure is below CORS/auth (DNS/TLS/connectivity to the Worker host) and this fallback should be removed rather than expanded.
