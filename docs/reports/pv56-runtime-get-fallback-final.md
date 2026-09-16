# #56 affected PWA Cloud GET compatibility fallback

## Confirmed runtime evidence (2026-09-17)

Read-only production diagnostics reported in #56 established:

- production Worker revision matches `ai-family-foundation` current main deployment;
- `AUTH_TOKEN` exists in production;
- OPTIONS for `/api/prompt-vault/cards` and `/gallery/recent` returns 204 with the expected CORS headers;
- authenticated GET `/cards` and `/gallery/recent` returns 200 from an independent client and reaches Worker with `outcome: ok`;
- the existing `?token=` authentication path also returns 200;
- the affected installed PWA still reports Fetch API `TypeError: Failed to fetch` for authenticated Cloud GETs.

This establishes a client-side transport/runtime incompatibility for the affected PWA. It does **not** by itself identify a specific browser vendor bug or browser version.

## Compatibility change

Bearer remains the normal Cloud authentication path. Only when a configured Prompt Vault Cloud **GET** with Bearer rejects with `TypeError` before an HTTP response is exposed, the frontend retries once using the already-supported `?token=` path.

The retry:

- is limited to the currently configured HTTPS `cloudUrl` origin/path;
- is GET-only;
- does not run for HTTP 401/403/404/5xx;
- does not run for AbortError or an aborted signal;
- removes `Authorization` and `Content-Type`, making the retry a simple GET;
- uses `cache: no-store`, `credentials: omit`, and `referrerPolicy: no-referrer`;
- does not apply to POST/PUT/DELETE.

`src/lib/api.js` also avoids adding `Content-Type: application/json` to bodyless requests so the fallback does not reintroduce a preflight through that header.

## Security follow-up

The compatibility retry places the long-lived token in a query parameter. This was already supported and runtime-verified by the Worker, but automatic use can expose the token in request-URL diagnostics/logs. This risk is tracked separately as #61. The compatibility path should be replaced by a non-query long-lived-token design before it is treated as a permanent transport layer.

## Required runtime verification

After Fran distribution is updated:

1. disable manual route pinning;
2. stop Fran API on port 8445;
3. confirm automatic route becomes Cloud;
4. confirm `/cards`, `/presets`, `/gallery`, `/gallery/recent` load in the affected PWA;
5. confirm thumbnails load;
6. confirm writes still use the normal Bearer path and are not routed through the GET fallback.
