# Roll back fix #10 Cloud route probe

## Why

The owner reports that around 2026-09-12 the installed PWA could use Cloud while Fran was off. Earlier runtime diagnosis showed the actually deployed Pages frontend at that time was pre-fix#10, while repository HEAD on 2026-09-12 already contained fix #10 (`7c850e5`). Therefore restoring the 2026-09-12 repository tree did not restore the actually-working deployed behavior.

## Change

Restore only the Cloud selection behavior from immediately before fix #10:

- Fran `/healthz` is checked first.
- If Fran is unavailable, Cloud `/healthz` success selects `route='cloud'`.
- The authenticated `/settings` precondition added by fix #10 is removed from route selection.
- The later probe-generation race protection is retained.
- Normal Cloud API requests still send the configured Bearer token, so invalid/missing credentials surface on the actual API call instead of forcing route `offline` during reachability selection.

## Known regression

This intentionally reintroduces the original #10 behavior: Cloud can be selected when `/healthz` succeeds even if the token is missing or invalid. Issue #10 must therefore be reopened until a replacement design separates transport reachability from auth state without blocking Cloud fallback.

## Runtime verification

After deployment to Fran, with manual route disabled:

1. Stop Fran on port 8445.
2. Confirm automatic route changes to Cloud rather than Offline.
3. Confirm cards, presets and album API calls succeed with the user's existing token.
4. If Cloud is selected but API calls fail, keep #56 open and diagnose the actual API path separately.
