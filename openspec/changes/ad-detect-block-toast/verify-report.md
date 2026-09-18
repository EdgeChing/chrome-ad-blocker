# Verify Report: ad-detect-block-toast

**Phase**: sdd-verify · **Date**: 2026-09-18 (re-execution; supersedes earlier same-day report — all claims independently re-run) · **Project**: chrome-ad-blocker
**Verdict**: **PASS WITH WARNINGS**
**Persistence note**: engram `mem_*` tools were unavailable to this session; this file is the
verify-report artifact (topic `sdd/ad-detect-block-toast/verify-report`) — filesystem fallback per
the openspec convention, same as the apply phase. No other files were modified.

---

## 1. Execution evidence (real runs, this session)

| Check | Command | Result |
|---|---|---|
| Tests | `npm test` (vitest run) | ✅ **174/174 passed**, 5 files, 0 failed, 0 skipped (391 ms); per-file: rules-shape 13 · classify 70 · popup 11 · user-rules 16 · background 64 |
| Tests (machine-parsed) | `vitest run --reporter=json` | ✅ TOTAL=174 PASSED=174 FAILED=0 SKIPPED=0 (exit 0) |
| Lint | `npx eslint .` | ✅ exit 0, no findings |
| Format | `npx prettier --check .` | ✅ "All matched files use Prettier code style!" |
| Build | — | ➖ No build step exists (plain-JS MV3 package; no `scripts.build`, no TS) — not a gap |
| Coverage | — | ➖ No `coverage_threshold` in `openspec/config.yaml` → skipped per skill |
| Seed integrity | `git diff HEAD -- rules.json` | ✅ EMPTY — 101 seed rules untouched |
| Legacy contract | HEAD vs working-tree grep | ✅ all five rejection strings (`untrusted sender` / `malformed message` / `unknown message type` / `enabled must be a boolean` / `unexpected message fields`) preserved; legacy matrix rows green |

**Completeness**: `tasks.md` — **24/24 `[x]`** (Phases 1–5). No incomplete tasks.
Apply-progress (24/24, "ready for verify") agrees with the checked list and with file reality.

---

## 2. Spec Compliance Matrix (15 delta scenarios + 1 MUST clause, behavioral evidence)

Statuses assigned per skill Step 6: COMPLIANT only with a *passing test* proving the behavior.

| # | Requirement | Scenario | Test (all PASSED this run) | Result |
|---|---|---|---|---|
| 1 | ad-blocking · User-Confirmed Dynamic Blocklist | Confirm blocks on reload | `user-rules.test.js > first confirmed host => … one DNR rule at id floor 1000` + `… no resourceTypes (main_frame safe)` | ⚠️ PARTIAL — extension-controllable half (rule registered, correct shape, main_frame-safe) pinned; actual network block on reload is Chrome platform behavior → manual item 22 |
| 2 | ad-blocking · User-Confirmed Dynamic Blocklist | Persist and dedupe | `user-rules.test.js > same host confirmed twice => one map key, one rule, second confirm adds NOTHING`; `…interleaved => still exactly one rule`; `…survives simulated restart: onStartup re-reconciles` | ✅ COMPLIANT |
| 3 | ad-blocking · Prompt Discipline | Once per host per session | `background.test.js > Once per host per session: second report … prompted:false` BUT `> per-tab isolation: the same host on another tab prompts independently` | ⚠️ PARTIAL — implemented/pinned at host×tab×session (design D3); spec text says "per host per session". Wording amendment or ledger-key change needed (W2) |
| 4 | ad-blocking · Prompt Discipline | Conservative gate rejects | `classify.test.js > …=> null` ×21 miss rows (1P lookalikes, non-ad 3P, parse doubt) + `background.test.js > first-party never offered … NO entry` | ✅ COMPLIANT |
| 5 | ad-blocking · Quota and Storage Limits | Storage failure | `user-rules.test.js > durable storage failure => {ok:false,error}, no DNR change, nothing shown blocked` (+ ledger-fail analog `background.test.js:472`) | ✅ COMPLIANT |
| 6 | ad-blocking · Quota and Storage Limits | Quota exhausted | `user-rules.test.js > capacity reached (MAX_USER_RULES=1000) => informed, NO rule added, map untouched` + `> DNR quota rejection surfaces as {ok:false,error}; ack never claims blocked` | ✅ COMPLIANT |
| 6a | ad-blocking · Prompt Discipline (MUST clause) | Non-retroactivity copy | (none automated) — copy present at `content.js:101-104` ("…starts at the next reload — it won't remove this one"), confirm-swap `:173`; manual item 19 | ⚠️ UNTESTED (automated) — see W1 |
| 7 | popup-ui · Per-Tab Detected Ad Sources List | List on open | `popup.test.js > ON with blocked + unblocked detections: domain, logo, 🚫 only if blocked, Block only if not` + `background.test.js > lists the ACTIVE tab's entries with blocked flags = effective ON ∧ (seed ∪ user)` | ✅ COMPLIANT |
| 8 | popup-ui · Per-Tab Detected Ad Sources List | Master toggle OFF respected | `background.test.js > effective OFF => enabled:false and NOTHING shown blocked`; `popup.test.js > master toggle OFF respected…`; `> while OFF (lastKnown false): success stores intent but shows NO 🚫` | ✅ COMPLIANT (ack-wording caveat → W3) |
| 9 | popup-ui · Per-Tab Detected Ad Sources List | Favicon unreachable | `popup.test.js > no favIconUrl … glyph immediately`; `> onerror swaps … exactly once, no loop`; `> glyph is deterministic per host` | ✅ COMPLIANT |
| 10 | popup-ui · Per-Tab Detected Ad Sources List | Per-tab isolation | `background.test.js > per-tab isolation: only the active tab's sources are listed` + integration full-loop | ✅ COMPLIANT |
| 11 | popup-ui · Single Global Toggle [A5] (MODIFIED) | Global control count unchanged | `popup.test.js > detection rows add NO global controls`; popup.js grep: zero allow/unblock affordances; popup.html has exactly one control + read-only list | ✅ COMPLIANT (delta-spec THEN sentence itself truncated → S1) |
| 12 | extension-shell · Minimal Packaged Capability (MODIFIED) | Offline retained | `rules-shape.test.js > still no remote code or external network rule sources`; fetch grep of shipped code: only `fetch(chrome.runtime.getURL("rules.json"))` (packaged read); glyph+intent+state in mocks; real-machine offline = manual item 4 | ✅ COMPLIANT (unit level; manual corroborates) |
| 13 | extension-shell · Minimal Packaged Capability (MODIFIED) | Confirmed rule is user data | `user-rules.test.js > first confirmed host…` (storage intent → one dynamic rule; no network source); `rules-shape.test.js` audit | ✅ COMPLIANT |
| 14 | extension-shell · Sole Injected UI [A4] | No cosmetic action | (none automated) — code review clean: full `content.js` audit shows DOM writes only on self-created toast subtree in closed shadow root (`:74-131`); sole page touchpoints = append own anchor (`:189`) / remove own anchor (`:157`); no style/visibility/classList/innerHTML on page nodes; manifest audit pins `content_scripts.css === []`. Manual item 27 is the design-sanctioned gate | ⚠️ UNTESTED (automated) — see W1 |
| 15 | extension-shell · Permissions Expansion Is Explicit | Declared only | `rules-shape.test.js > every used chrome.* namespace maps to a declared permission`, `> content script is packaged, http/https-scoped, document_idle, gate before script`, `> host_permissions cover the content-script matches`; manifest read directly: `+tabs`, `+<all_urls>`, one content_scripts entry — exactly the reviewed delta | ✅ COMPLIANT |

**Compliance summary**: 12/15 scenarios fully pinned by passing tests; 3 PARTIAL/automated-untested (1 platform-behavior boundary, 1 spec-wording mismatch, 1 manual-layer-gated surface); 0 FAILING; 0 spec violations found.

---

## 3. Correctness (static — source read this session, not summaries)

| Requirement area | Status | Notes |
|---|---|---|
| Router + per-type validators (task 2.1) | ✅ Implemented | `background.js:378-484`: exact-key checks, host regex `^[a-z0-9][a-z0-9.-]*$` ≤253, `sender.tab` required for `reportDetected`, forbidden for `getDetectedAds`, tabId never caller-supplied; legacy strings intact |
| Seed-hosts cache (2.2) | ✅ | `loadSeedHosts` once per SW life; load failure ⇒ honest empty list |
| Session ledger (2.3/D3) | ✅ | `storage.session.detectedAds` tabId→host→`{firstSeen,prompted}`; latched at prompt; `tabs.onRemoved` prune (`:363-376`); OFF/seed/user suppression (`:281`) |
| User-block intent + reconcile (2.4/D4/D5/D6) | ✅ | `userBlockedHosts` map; desired = `enabled ? keys : []`; diff add/remove inside serialized chain; id floor 1000, disjoint from seed ids 1–101; cap 1000; failure ⇒ `{ok:false,error}` never false success |
| content.js detection + toast (2.7/D1/D8) | ✅ (untested) | Buffered `PerformanceObserver('resource')` + seed pass → `AdClassify.classifyLoad` → report; toast only on SW `prompted:true` ack; queue, 8 s auto-dismiss, ×, ack swap; closed shadow, inline style |
| classify.js gate (1.1/D2) | ✅ | Tokens/suffixes exactly per D2; doubt ⇒ first-party ⇒ null; pure (zero DOM/chrome refs); `AdClassify` on globalThis (deviation 3, accepted) |
| Popup list/Block (3.1–3.3/D7) | ✅ | Second query in `refresh()`; 🚫 gated on ack `enabled ∧ blocked` AND `lastKnown === true`; glyph fallback; honest failure path; per-button in-flight lock; no unblock UI (A5, locked default #2) |

## 4. Coherence (design decisions D1–D8)

| Decision | Followed? | Notes |
|---|---|---|
| D1 PerformanceObserver buffered + seed pass | ✅ | `content.js:57-71` |
| D2 3P test + conservative gate | ✅ | `classify.js` token/suffix lists exactly match; FP/FN pinned by 70 tests |
| D3 SW-side ledger arbitration | ⚠️ Deviated (valid) | once/host/**tab**/session per design text; ad-blocking delta-spec omits "tab" → matrix row 3, W2. Ledger writes serialized on `applying` (house pattern extension; needed for `prompted` atomicity) |
| D4 `userBlockedHosts` sole intent, missing ⇒ {} | ✅ | `background.js:65-70` |
| D5 user rules exist only while ON, self-heal reconcile | ✅ | in `applyBlockingState` + `handleBlockHost` + onInstalled/onStartup |
| D6 id floor 1000, rule shape no `resourceTypes`, cap 1000 | ✅ | pinned incl. disjointness (`rules-shape.test.js:88`); task 1.4 docs-unreachable resolution recorded in design.md |
| D7 favIconUrl page-reported + glyph fallback, no remote fetch | ✅ | `background.js:357`, `popup.js:91-101` |
| D8 closed-shadow toast, inline CSS, 8 s, ×, non-retro copy | ✅ | `content.css` not created — proposal-scope wording superseded by D8; audit enforces empty CSS list (accepted deviation 2) |
| File Changes table | ✅ | all 9 rows delivered + documented test-only extras (`sw-harness.js`, `popup.test.js`); manifest js list gains `classify.js` ahead of `content.js` — required by D2 gate-sharing, pinned by audit |

## 5. Boundary audit (clean)

- **A4**: exhaustive content.js DOM-write grep — only self-owned nodes; removal only of own anchor; already-visible ads untouched.
- **Top-level navigation**: no `resourceTypes` in any seed rule (raw-text check `rules-shape.test.js:57`) nor user rule shape; `rules.json` diff vs HEAD EMPTY.
- **Single writer**: popup performs zero storage/DNR writes (grep clean); reads ground truth only.
- **A5**: toggle remains the only global control; rows are blocklist-growth only.
- **Legacy suites**: A2 default-ON, OFF-survives-update (CRITICAL scenario), fast OFF-ON-OFF — all still green (34 background router/lifecycle tests).

---

## 6. Issues found

**CRITICAL** (must fix before archive): None.

**WARNING** (should fix / need user decision before archive):
1. **`content.js` has no automated test layer** — scenarios 14 (No cosmetic action) and 6a (non-retroactivity copy) rest on code review + unexecuted manual items 19–27. Design's Testing Strategy sanctions the manual layer, but jsdom coverage (toast attach/remove self-only, copy text, queue, 8 s dismiss) would close the gap. Playwright E2E tooling still not installed.
2. **Spec↔implementation granularity mismatch** — ad-blocking spec: "at most once per host per session"; code+design+tests pin host×tab×session (`background.test.js:391` pins cross-tab independent prompts deliberately). Amend the delta-spec line ("per host per tab per session") at archive — or change the ledger key.
3. **`blockHost`-while-OFF ack `{ok:true, blocked:true}`** stores intent without a rule (design Interfaces contract has no enabled-branch; popup never renders 🚫 while OFF — triple-gated). Narrow race: a confirm concurrent with an OFF flip leaves toast copy promising next-reload blocking that is pending until master is re-enabled. Needs one-line user sign-off on wording.
4. **Working tree uncommitted** — 17 dirty entries at `6351c91`; commit before `sdd-archive`.
5. **Manual checklist items 19–27 not yet executed** — real-browser toast/reload/restart/offline/re-consent behavior remains the user's release gate (items exist, incl. `<all_urls>` re-consent release note).

**SUGGESTION**:
1. Complete the truncated THEN clause in `specs/popup-ui/spec.md:44` ("…the only control that can") before syncing deltas.
2. At archive, record proposal→design supersessions: `content.css` → inline shadow styles; content-script js list gains `classify.js`; new test-only files `sw-harness.js`/`popup.test.js`.
3. State the "OFF ⇒ blockHost ack means stored intent" nuance explicitly in the canonical popup-ui spec at sync time.

---

## 7. Verdict

**PASS WITH WARNINGS** — 174/174 tests, eslint, and prettier green on real execution; 12/15 delta scenarios fully pinned by passing tests, 3 partial/manual-gated, zero violations; design D1–D8 coherently followed (two documented, valid deviations); seed integrity, legacy rejection matrix, and all safety boundaries (A2/A4/A5, main_frame safety, single-writer) verified intact. Next: resolve Warnings 1–3 (user decisions), fix spec wording, commit, then `sdd-archive`.
