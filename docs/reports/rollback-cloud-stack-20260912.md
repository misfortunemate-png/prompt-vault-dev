# Cloud stack rollback to 2026-09-12 baseline

This rollback restores the frontend Cloud connection/API transport files to commit `d84847ef38f619d3f6723cc04ca9448495a9c551` (2026-09-12), the last known-good period reported by the owner before the 2026-09-16 review fixes.

Restored files:
- `src/App.jsx`
- `src/lib/connection.js`
- `src/lib/api.js`
- `src/main.jsx`

Removed compatibility artifacts introduced by PR #58:
- `src/lib/cloudFetchFallback.js`
- `scripts/verify-pv56-cloud-fallback.mjs`
- `docs/reports/pv56-cloud-get-fallback.md`

The Worker repository is not rolled back because the diagnosed production `/healthz` and authenticated `/settings` returned 200 and no Worker change was made during this review sequence.
