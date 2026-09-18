# Tasks: ad-detect-block-toast

## Phase 1 — Foundation

- [x] 1.1 Create `classify.js` (pure, DOM/chrome-free): URL ad-token gate + last-2-label registrable-domain 3P test, patterns/eTLD exceptions exactly per design D2; doubt ⇒ first-party.
- [x] 1.2 Create `test/classify.test.js` (RED/GREEN paired with 1.1): FP/FN matrix — 1P lookalikes, exception TLDs, token hit/miss.
- [x] 1.3 Modify `manifest.json`: add `tabs` permission, `host_permissions:["<all_urls>"]`, `content_scripts` (http/https, `document_idle`, `content.js`).
- [x] 1.4 Verify open questions at apply time: DNR dynamic-rule cap + update-persistence (docs or local Chrome); keep D6 ids/cap unless evidence says lower — persistence moot via D5 self-heal. Record in `design.md`.

## Phase 2 — Core

- [x] 2.1 `background.js`: per-type router table; validators for `reportDetected` (host regex `^[a-z0-9][a-z0-9.-]*$` ≤253, `sender.tab` required), `blockHost`, `getDetectedAds` (exact key `type`; tabId never trusted from caller). Existing `toggleBlocking` rejection strings unchanged.
- [x] 2.2 `background.js`: seed-hosts cache — `fetch(chrome.runtime.getURL("rules.json"))` once per SW life; `blocked` = ON ∧ (seed ∪ user).
- [x] 2.3 `background.js`: ledger `storage.session.detectedAds` (tabId→host→`{firstSeen,prompted}`), `tabs.onRemoved` prune; D3 arbitration (once/host/tab/session, 1P vs sender URL, known, OFF ⇒ suppress) → `{ok,prompted}`.
- [x] 2.4 `background.js`: `storage.local.userBlockedHosts` (missing ⇒ `{}`) + D5/D6 reconcile inside `applying`: add missing / `removeRuleIds` extras per D6 rule shape (`||<host>^`, no `resourceTypes`, id = `max+1` ≥1000); toggle OFF removes user rules; quota/storage failure ⇒ `{ok:false,error}`, never false success.
- [x] 2.5 Create `test/user-rules.test.js`: dedup/idempotency, id floor/allocation, reconcile both ways incl. OFF-removal, quota/storage-fail acks.
- [x] 2.6 Modify `test/background.test.js`: mocks +`get/updateDynamicRules`, `tabs`, `storage.session`; new-type malformed rows.
- [x] 2.7 Create `content.js` per D1/D8: buffered `PerformanceObserver('resource')` → 1.1 gate → `reportDetected`; single queued closed-shadow toast, auto-dismiss 8 s, ×, non-retroactivity copy, confirm-ack swap, `prompted` latched at prompt.

## Phase 3 — Wiring

- [x] 3.1 Modify `popup/popup.html` + `popup/popup.css`: detected-sources section (domain, logo, 🚫, Block button); toggle stays sole global control.
- [x] 3.2 Modify `popup/popup.js`: `getDetectedAds` as second query in `refresh()`; render `entries`+`favIconUrl`; 🚫 only when ack `enabled` and `blocked` (OFF ⇒ nothing shown blocked); `<img onerror>` → deterministic letter-glyph SVG data-URI.
- [x] 3.3 Modify `popup/popup.js`: Block → `blockHost`; honest ack render (success sets 🚫; failure shows error, no false blocked state); in-flight lock per house pattern.
- [x] 3.4 Integration-ish test (mocked SW, microtask settle): report→prompt→block→rule round-trip; per-tab isolation.

## Phase 4 — Testing / Verification

- [x] 4.1 "Confirm blocks on reload" + "Persist and dedupe": double-confirm ⇒ exactly one rule/entry; survives simulated restart (`onStartup` re-reconcile).
- [x] 4.2 "Once per host per session", dismiss sticks, "first-party never offered", "Conservative gate rejects".
- [x] 4.3 "Master toggle OFF respected": nothing shown blocked AND user dynamic rules removed (D5, approved).
- [x] 4.4 "Storage failure" + "Quota exhausted": failure surfaces, nothing shown blocked.
- [x] 4.5 "Favicon unreachable" + "Offline retained" (glyph fallback); "Declared only" audit (every used API ⊆ manifest).
- [x] 4.6 Full `npm test` green; rejection matrix unchanged.

## Phase 5 — Cleanup

- [x] 5.1 Modify `test/fixtures/ad-page.html`: add non-seeded ad-pattern 3P URL; note http serving required (`file://` gets no content script).
- [x] 5.2 Modify `test/manual-checklist.md`: toast/confirm/reload/restart/🚫/OFF items; release note re `<all_urls>`+`tabs` update re-consent warning.
- [x] 5.3 Polish headers/comments to house style; confirm out-of-scope absent (no element hiding, unblock, remote lists, i18n).
