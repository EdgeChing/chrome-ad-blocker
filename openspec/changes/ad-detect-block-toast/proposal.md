# Proposal: ad-detect-block-toast

## Intent

The 101-rule seed misses most ads; users can't see a page's ad sources or teach the extension new ones. Add (1) a popup dropdown of detected ad sources (domain, logo, 🚫 indicator); (2) an in-page toast offering to block unlisted ads — confirmed hosts persist, blocked onward. Per design doc §二/§三C/§五; see `explore.md`.

## Approach (locked)

- `content.js` detects via resource timing + conservative gate: third-party + ad URL patterns. In-page toast = sole injected UI. Fallback if `<all_urls>` rejected: `webRequestObserver` + system notifications.
- Confirm → SW adds dynamic DNR rule `||host^` in a user-id namespace, `resourceTypes` omitted (top-level navigation safe). Effective future/reload; visible creative NOT removed (A4 intact).
- Blocklist (idempotent, deduped) in `storage.local`; per-tab ledger + rate limit in `storage.session`. One toast per host per session; dismiss = stop asking; first-party never offered.
- Logos: `tab.favIconUrl`, local letter-glyph SVG fallback; no remote fetcher.
- `background.js` router: strict type-dispatch (`getDetectedAds`, `blockHost`); rejection kept.

## Scope

In: `content.js`/`content.css`; `manifest.json` (+`content_scripts`, `host_permissions`, `tabs`); `background.js` blocklist + ledger; `popup/*` list + Block button; `test/*` unit + manual checklist/fixture.
Out: element hiding; remote filter lists; per-site whitelists; popup live push; i18n.

## Spec deltas

- `popup-ui` A5: toggle stays the only *global* control; popup MAY add detected-ads list + per-host block affordances (blocklist growth, not per-site allow).
- `extension-shell`: "Minimal Packaged Capability" amended — network rule updates stay forbidden; user rules are user data; content script packaged; Offline holds. A4 retained: toast is the only injection, no hiding/modifying.
- `ad-blocking`: new "User-Confirmed Dynamic Blocklist" — persists across restart/update, idempotent append, never blocks top-level navigation; seed unchanged.

## Risks

- Classifier false positives (Med-High) → conservative gate, session cap, dismiss-stops-asking
- `<all_urls>` store friction (Med) → explicit decision; observer fallback
- Dynamic-rule id/quota bookkeeping (Low) → verify at design
- SW death / popup closed (Low) → session ledger, query-on-open

## Rollback

Revert code + manifest (seed untouched). Remove user rules via `updateDynamicRules({removeRuleIds})`; clear blocklist/ledger keys; revert spec deltas at archive.

## Dependencies

None third-party; verify Chrome DNR/storage constants at design.

## Open Questions

1. `<all_urls>` (recommended) or observer + notifications fallback?
2. Unblock affordance for user hosts now, or deferred?
3. Toast copy "blocked from next load — reload to see" acceptable?

## Success Criteria

- [ ] Popup lists per-tab sources with logo + 🚫 consistent with seed/user blocklist (toggle OFF ⇒ nothing shown blocked)
- [ ] Unlisted ad-pattern load triggers ≤1 toast/host/session; confirm blocks on reload, survives restart
- [ ] Existing tests green; new: blockHost, dedup, ledger, router
- [ ] Manual checklist passes on `ad-page.html` fixture
