# Apply Progress: ad-detect-block-toast

**Phase**: apply (sdd-apply, TDD mode)
**Date**: 2026-09-18
**Status**: 24/24 tasks complete — ready for verify
**Persistence note**: engram `mem_*` tools were unavailable to the apply executor this session;
this file is the apply-progress artifact (topic `sdd/ad-detect-block-toast/apply-progress`).
Tasks were checked `[x]` in `tasks.md` as they completed (openspec convention).

## Mode & cycle

TDD detected (vitest + test files alongside source; tasks 1.2/2.5/2.6 spec RED/GREEN pairs).
Every functional area ran RED → GREEN → REFACTOR:

| Area | Test file | RED | GREEN |
|---|---|---|---|
| 1.1/1.2 gate | `test/classify.test.js` | ✅ failed (module absent) | ✅ 70/70 |
| 2.1–2.3 router/ledger | `test/background.test.js` (via `test/sw-harness.js`) | ✅ 33 failed | ✅ 64/64 |
| 2.4 user rules | `test/user-rules.test.js` | ✅ 15 failed | ✅ 16/16 |
| 3.2–3.3 popup | `test/popup.test.js` (fake DOM) | ✅ 10 failed | ✅ 11/11 |
| 4.5 declared-only audit | `test/rules-shape.test.js` (+audit) | ✅ pinned | ✅ 13/13 |

Final: `npm test` → **174/174 passed (5 files)**; `eslint .` clean; `prettier --check .` clean.
Legacy `toggleBlocking` rejection matrix byte-identical and green (task 2.6/4.6 requirement).

## Files

| File | Action |
|---|---|
| `classify.js` | Created — pure gate (D2): registrable-domain 3P + eTLD-exception list, host/path token gate, doubt ⇒ first-party ⇒ null; published as `AdClassify` on globalThis (classic-script + ESM-test dual delivery) |
| `content.js` | Created — buffered `PerformanceObserver('resource')` + seed pass (D1) → gate → `reportDetected`; closed-shadow toast queue: auto-dismiss 8 s, ×, non-retroactivity copy, confirm-ack swap; removes all traces on close (A4) |
| `background.js` | Modified — per-type router table (untrusted/malformed/unknown strings unchanged); `importScripts("classify.js")` guard; seed-hosts fetch cache (2.2); session ledger + `tabs.onRemoved` prune + D3 arbitration → `{ok,prompted}` (2.3); `userBlockedHosts` intent map + D5/D6 `reconcileUserRules()` inside `applying` (2.4) — add missing/remove extras, id floor 1000, `||<host>^` no-resourceTypes, capacity/storage/quota ⇒ `{ok:false,error}` |
| `manifest.json` | Modified — `+tabs`, `+host_permissions ["<all_urls>"]`, `+content_scripts` (http/https, document_idle, `classify.js` then `content.js`); description updated |
| `popup/popup.html|css|js` | Modified — sources section (domain, favicon→glyph, 🚫, Block); `getDetectedAds` second query in `refresh()`; 🚫 only when ack enabled ∧ blocked; honest-ack block flow with per-button in-flight lock; `sendToggle` refactored onto shared `sendRequest`; A5 preserved (toggle sole global control) |
| `test/sw-harness.js` | Created — `loadSw` house idiom extracted + extended (dynamic rules, tabs, storage.session, seed fetch) for shared use |
| `test/classify.test.js` `test/user-rules.test.js` `test/popup.test.js` | Created (per tasks 1.2/2.5/3.x–4.5) |
| `test/background.test.js` | Modified — harness-based mocks (2.6), router/ledger/getDetectedAds suites, 3.4 integration describes |
| `test/rules-shape.test.js` | Modified — declared-only manifest audit, content-script shape, seed-id < 1000 disjointness |
| `test/fixtures/ad-page.html`, `test/manual-checklist.md` | Modified — 5.1/5.2 (unseeded ad-pattern URL, http-serving note, items 19–27, `<all_urls>` re-consent release note) |
| `eslint.config.js` | Modified — browser block covers `classify.js`/`content.js`, `AdClassify` readonly global |
| `design.md` (artifact) | Modified — Open Questions resolved at apply: DNR cap docs unreachable → D6 kept (floor/cap 1000, self-heal per D5); ad-list curation frozen |

## Deviations from design (all noted, none semantic)

1. **`test/sw-harness.js` + `test/popup.test.js` are new files** not in the design File Changes
   table — needed to share the `loadSw` mock across three suites and to unit-test popup rendering
   (design's Testing Strategy only listed mocked-SW layers). Additive, test-only.
2. **`content.css` (proposal Scope wording) was NOT created** — design D8 supersedes: all toast
   styling is inline in the closed shadow root. Manifest audit test enforces `content_scripts.css`
   stays empty.
3. **classify.js delivery**: publishes `AdClassify` on `globalThis` (classic script for both the
   content-script world and the SW via guarded `importScripts`), so the ESM vitest loader can
   side-effect-import it. Purity ("DOM/chrome-free") holds.
4. **Ledger writes + prunes + reconciles are serialized on the same `applying` chain** —
   consistent with "single-writer SW" house pattern; the design mandated it only for DNR writes.

## Issues / notes for verify

- Web docs were unreachable this session (task 1.4 fallback used as pre-authorized in tasks.md).
- blockHost while master OFF returns `{ok:true,blocked:true}` (intent accepted) but adds no rule
  until ON — popup renders the saved-intent message, never a 🚫 while OFF (spec-compliant reading
  of D5 + "OFF respected"; worth a verify double-check of wording).
- `getDetectedAds` `enabled` is DNR ground truth (`getEnabledRulesets`), `prompted` suppression
  uses stored intent — drift window self-heals via popup re-sync; matches design text.
- Toast auto-dismiss timer keeps running during a pending block ack (8 s from prompt, per D8).
- Real-browser behavior (network blocking, toast rendering, re-consent warnings) remains gated on
  manual checklist items 19–27 — Playwright E2E tooling still not installed (out of this change).
