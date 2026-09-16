# Roll back fix #10 Cloud route probe

> **Superseded (2026-09-17):** This rollback was a temporary diagnostic step. The later #56 investigation found that the affected PWA held the historical path-less Worker URL while the current frontend expected the Prompt Vault API base. That value came from the original user-facing connection design, not a user error. PR #64 canonicalized the Cloud endpoint, and PR #66 restored the authenticated `/settings` probe from #10/#53. The rollback described below is no longer current behavior.

## Historical reason for rollback

The owner reported that around 2026-09-12 the installed PWA appeared able to use Cloud while Fran was off. During investigation, repository HEAD and deployed/frontend state did not align, so the #10 authenticated probe was temporarily removed to reproduce earlier route-selection behavior.

At that point the missing `/api/prompt-vault` suffix in the affected PWA's stored `cloudUrl` had not yet been identified.

## Historical change

The temporary rollback did the following:

- Fran `/healthz` was checked first.
- If Fran was unavailable, Cloud `/healthz` success selected `route='cloud'`.
- The authenticated `/settings` precondition added by fix #10 was removed from route selection.
- Probe-generation race protection was retained.

This intentionally reintroduced the original #10 defect: a reachable Cloud health endpoint could be selected even when the token was absent or invalid.

## Final state

PR #64 now makes Cloud endpoint identity product-owned and migrates any historical stored `cloudUrl` to the canonical `https://ai-family-foundation.misfortunemate.workers.dev/api/prompt-vault` API base.

PR #66 restored the authenticated Cloud selection behavior:

1. Fran `/healthz` success -> Fran.
2. Fran unavailable -> canonical Cloud `/healthz`.
3. Cloud health success requires a token and authenticated `/settings` success before `route='cloud'`.
4. Missing token, 401/403, and other Cloud API failures are distinguished through `cloudOfflineReason`.

Issue #10 is therefore closed again. This file remains only as a record of the temporary diagnostic rollback.
