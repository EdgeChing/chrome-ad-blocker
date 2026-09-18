# Design: ad-detect-block-toast

## Technical Approach

Packaged `content.js` detects third-party ad-pattern loads via resource timing and reports to the single-writer SW. SW arbitrates toasts (session ledger), persists confirmations as a `storage.local` host-intent map reconciled into DNR dynamic rules, and answers popup query-on-open. Toast = sole injected UI (A4). House style kept: promise chains, `applying` serialization, strict exact-key validation, no durable in-memory state.

## Architecture Decisions

| # | Decision | Alternatives | ✅ Choice & rationale |
|---|---|---|---|
| D1 | Detection source | `getMatchedRules` (blind to unblocked) · `webRequestObserver` (heavier, no near-ad UI) | **`PerformanceObserver('resource',{buffered:true})` + `getEntriesByType` seed** — sees loaded unblocked ads; plan-doc §二 |
| D2 | 3rd-party test & ad gate | full eTLD+1 (needs PSL, impossible offline) · exact hostname · broad `/ad/i` (FP-prone) | **3P:** last-2-labels registrable-domain + exception list (`co.uk,com.cn,org.cn,net.cn,gov.cn,co.jp,or.jp,ne.jp`); doubt ⇒ first-party ⇒ never report. **Ad gate (host/URL boundary-ish tokens only):** `doubleclick, googlesyndication, adservice(s), adroll, taboola, outbrain, moatads, ads?/path, banner, track(er|ing), popunder, infeed, mmstat, tanx, cpro`. Conservative |
| D3 | Toast arbitration | content-side state (session storage = trusted-contexts only) | **SW decides:** `reportDetected` ack carries `prompted`; SW checks ledger (once/host/tab/session), 1P vs `sender.tab.url`, seed/user membership, intent OFF ⇒ suppress |
| D4 | Durability | derive list from `getDynamicRules` only (breaks D5) | **`storage.local.userBlockedHosts = {host:true}`** — O(1) dedup/idempotency; missing ⇒ `{}`; sole intent |
| D5 | Toggle-OFF semantics | leave user rules active (violates A5 + "OFF ⇒ nothing blocked") | **User dynamic rules exist only while ON.** Extend apply pipeline: reconcile `getDynamicRules()` vs `enabled? keys(map):[]` — add missing / `removeRuleIds` extras; idempotent, serialized; self-heals regardless of update-persistence (OQ1) |
| D6 | Rule ids | store id in map (stale after re-add) · hash | **Floor `USER_RULE_ID_START=1000`** (debug-disjoint from 1–101); next = `max(dynamic ids)+1`. Rule: `{id,priority:1,action:{type:"block"},condition:{urlFilter:"||<host>^"}}` — `resourceTypes` omitted (main_frame safe). Cap `MAX_USER_RULES=1000` conservative; quota/storage failure ⇒ `{ok:false,error}`, never false success |
| D7 | Logos | per-host favicon (remote fetch — MUST NOT) · s2 proxy (tracking) | **SW `tabs.query({active,currentWindow})` → `favIconUrl` (page-reported, needs `tabs`) in ack; `<img onerror>` → local deterministic letter-glyph SVG data-URI.** Offline-safe |
| D8 | Toast UI | notifications (desktop) · light DOM (CSS bleed) | **Closed shadow root on `documentElement`; queue, one at a time, inline `<style>`, auto-dismiss 8 s, × button.** English copy (popup is `lang="en"`), states non-retroactivity ("…starts at the next reload — won't remove this one"); confirm ack swaps the message. Dismiss = remove only (`prompted` latched at prompt time) |

## Interfaces / Contracts

Router = per-type table; common checks and existing error strings unchanged (rejection matrix stays green). Content senders have `sender.tab`, popup senders don't — asserted per type. `blocked` = effective-ON (`getEnabledRulesets`) ∧ host ∈ seed ∪ user; OFF ⇒ all false. Seed hosts: SW `fetch(chrome.runtime.getURL("rules.json"))` once per SW life (packaged; offline-OK). Ledger: `storage.session.detectedAds = {tabId:{host:{firstSeen,prompted}}}`; `tabs.onRemoved` prunes tabId.

| type | sender | exact keys | ack |
|---|---|---|---|
| `toggleBlocking` | popup | `type,enabled:boolean` | `{ok,enabled}` |
| `reportDetected` | content | `type,host` — regex `^[a-z0-9][a-z0-9.-]*$` ≤253 | `{ok,prompted}` |
| `blockHost` | content\|popup | `type,host` | `{ok,blocked:true}` \| `{ok:false,error}` |
| `getDetectedAds` | popup | `type` only (SW resolves active tab; tabId never trusted from caller) | `{ok,enabled,entries:[{host,blocked}],favIconUrl}` |

## Data Flow

```
content gate(D1,D2) ─reportDetected─▶ SW: ledger/1P/known/OFF checks ─{prompted}─▶ shadow toast
  Block ─blockHost─▶ SW: storage.set map (intent FIRST) ─▶ reconcile updateDynamicRules(add max+1) ─▶ ack
popup open ─getDetectedAds─▶ SW: tabs.query + session ledger + map + DNR truth ─▶ entries+favIconUrl
```

## File Changes

| File | Action | Description |
|---|---|---|
| `content.js` | Create | observer → gate (`classify.js`) → report; shadow-DOM toast |
| `classify.js` | Create | pure gate: URL ad-pattern set + registrable-domain 3P test (DOM/chrome-free) |
| `manifest.json` | Modify | +`tabs`; +`host_permissions:["<all_urls>"]`; +`content_scripts` (http/https, `document_idle`) |
| `background.js` | Modify | type-table router; session ledger + `tabs.onRemoved`; user-rule map + reconcile (D5/D6) inside `applying`; new handlers; seed-hosts loader |
| `popup/popup.html|js|css` | Modify | sources section + Block buttons; second query in `refresh()`; glyph fallback; styles |
| `test/classify.test.js` | Create | gate FP/FN matrix (1P lookalikes, exceptions, patterns) |
| `test/user-rules.test.js` | Create | dedup/idempotency, id floor/allocation, reconcile both ways, quota/storage-fail acks |
| `test/background.test.js` | Modify | mocks +`updateDynamicRules/getDynamicRules`,`tabs`,`storage.session`; new-type malformed rows; old matrix untouched |
| `test/fixtures/ad-page.html`, `test/manual-checklist.md` | Modify | +non-seeded ad-pattern URL; toast/confirm/reload/restart/🚫 items — serve via http (`file://` gets no content script) |

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit | classifier; router matrix; blockHost dedup; ids; reconcile; failure acks | vitest node env, mocked `chrome.*` (`loadSw` idiom) |
| Integration-ish | report→prompt→block→rule round-trips; per-tab isolation | same mocks, microtask settle |
| Manual | ≤1 toast/host/session; dismiss sticks; reload blocks; survives restart; OFF hides 🚫 + removes user rules | extended checklist on fixture |

## Migration / Rollout

No data migration (new keys default-safe). **Existing installs get `<all_urls>`+`tabs` warnings on update; CWS may require re-consent — note in release.** Rollback: revert code/manifest; `updateDynamicRules({removeRuleIds: getDynamicRules().map(r=>r.id)})`; leftover keys harmless.

## Open Questions

- [x] **Verify before tasks (non-blocking; design is quota-independent):** dynamic-rule cap (commonly cited 5,000; capped 1,000 meanwhile) and update-persistence (D5 self-heals). Docs unreachable this session too.
  - **Resolved at apply (task 1.4, 2026-09-18):** both Chrome reference pages (`/docs/extensions/reference/api/declarativeNetRequest` and `/docs/extensions/declarativeNetRequest/limits`) were unreachable from this session (transport errors), so no lower-evidence was obtainable. Keeping D6 unchanged: `USER_RULE_ID_START = 1000`, `MAX_USER_RULES = 1000` (conservative against the commonly cited 5,000 dynamic-rule cap). Update-persistence is moot: D5 re-derives user rules from `storage.local.userBlockedHosts` on every lifecycle event via `reconcileUserRules()` inside the serialized `applying` chain, so rules are re-added after any platform reset. Real quota overflow still surfaces as `{ok:false,error}` (never false success).
- [ ] `<all_urls>` store acceptance (locked default #1); observer+notifications fallback documented only. — **EXTERNAL, still open:** CWS review outcome cannot be verified locally; code ships per locked default #1, fallback stays documentation-only.
- [x] Final ad-pattern list curation (seeded in `classify.js`, tightened in tasks).
  - **Resolved at apply:** list frozen in `classify.js` exactly per D2 — host-label tokens `doubleclick, googlesyndication, adservice(s), adroll, taboola, outbrain, moatads, mmstat, tanx, cpro`; path-segment tokens `ad(s), banner, track/tracker/tracking, popunder, infeed` (+ `.ext` basenames); exception suffixes `co.uk, com.cn, org.cn, net.cn, gov.cn, co.jp, or.jp, ne.jp`. FP/FN behavior pinned by 70 matrix cases in `test/classify.test.js` (incl. 1P-lookalike suppression and `chart.js`/`jsdelivr`-style miss controls).
