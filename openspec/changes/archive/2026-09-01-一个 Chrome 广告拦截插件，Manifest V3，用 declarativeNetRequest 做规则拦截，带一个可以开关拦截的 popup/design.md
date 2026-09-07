# Design: Chrome 广告拦截插件 (MV3 + declarativeNetRequest + popup toggle)

## Technical Approach

Static packaged DNR ruleset + single-writer service worker that derives enabled-ruleset state from `chrome.storage.local` intent; popup only messages the SW. Greenfield — no existing code; this change defines the architecture, implementing proposal Approach 1 against all three specs.

## Architecture Decisions

| Decision | Option (tradeoff) | ✅ Decision & rationale |
|---|---|---|
| Toggle mechanism | Dynamic-rule push per toggle (~500 ops/click, races) · session allow-override (dies on shutdown+update → re-apply every startup; more lifecycle surface) | **Static ruleset + `updateEnabledRulesets`** — zero quota churn, browser holds rules independent of SW liveness (exploration rec.) |
| Manifest ruleset default | `enabled:true` (blocks from t=0, but update silently flips user's OFF→ON until SW syncs) | **`enabled:false`** — safe default; true state only ever comes from SW reading storage intent (proposal, authoritative) |
| Permissions | `host_permissions:["<all_urls>"]` (broad install warning) | **`["declarativeNetRequest","storage"]` only** — block/allow actions need no host permission |
| State ownership | Popup writes DNR/storage directly (two writers, divergent states) | **SW sole writer**; popup sends message only; one idempotent `applyBlockingState(enabled)` for all paths |
| Update-reset recovery | Rely on manifest value | **Re-apply on `onInstalled` (ALL reasons — `"update"` is the mandatory path) + `onStartup` + toggle message**; no durable in-memory state (SW dies ~30s idle) |
| Rule encoding / resourceTypes | `"*"` (invalid per D2 — silently ignored) · explicit enum list (risk: breaks pages using ad hosts for content) | **Omit `resourceTypes`** = Chrome default "all except `main_frame`" → satisfies Top-Level-Navigation spec req; `urlFilter` `"||domain^"` per `files/rules.example.json` (D3: rules at root, not `_locales`) |
| Seed sourcing | Runtime fetch (violates offline req) · build-time EasyList parse | **Hand-curated 50–500 domains**: CN (Alimama, Baidu Union, Tencent) + global ad/tracker; parser = fast-follow (A3) |
| Popup display | Trust cached/storage value (misleads if DNR drifts) | **On open: `getEnabledRulesets()` = ground truth**, reconcile vs storage intent; read failure → "unknown", never a guess |
| Toolchain pin | Full Playwright MV3 harness now (heavy setup) | **ESLint (flat config) + Prettier + vitest** (pure logic, mocked `chrome.*`); Playwright E2E deferred → manual checklist for MVP. Node 22.19.0 / npm 11.6.2 confirmed |

> Note: launch brief carried exploration-era values (`enabled:true`, `<all_urls>`); proposal.md supersedes — design follows on-disk artifacts. Config's "~512 rules/update" is stale (D1); ~500 rules ≪ 30k static quota, no per-call cap.

## Data Flow

**1. Toggle (sequence):**

```
Popup                    SW (background.js)              DNR / Network stack
  │ runtime.sendMessage {type:"toggleBlocking",enabled:false}
  ├───────────────────────▶│ validate; append to apply chain (collapse rapid)
  │                        │ storage.set {blockingEnabled:false}
  │                        │ updateEnabledRulesets({disable:["ad_rules"]})
  │                        ├────────────────────────▶ seeded sub-resource requests pass
  │◀────── ack {ok:true,enabled:false} ─────────────┤
```

**2. Lifecycle recovery:**

```
onInstalled(install|update|…) ─┐
onStartup ─────────────────────┼─▶ SW wake ─▶ read storage.blockingEnabled
toggle message ────────────────┘                (missing ⇒ true)
                                     │
                        applyBlockingState(enabled)  ──▶ DNR matches intent (idempotent)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `manifest.json` | Create | MV3 skeleton; `rule_resources:[{id:"ad_rules",path:"rules.json",enabled:false}]`; `action.default_popup:"popup/popup.html"` |
| `rules.json` | Create | Seed block rules (shape = `files/rules.example.json`) |
| `background.js` | Create | SW: sole writer; message handler + lifecycle re-apply |
| `popup/popup.html` / `.css` / `.js` | Create | Single switch; truth-read; message + ack render |
| `package.json`, `eslint.config.js`, `.prettierrc`, `vitest.config.js`, `.gitignore` | Create | Pinned minimal toolchain |

## Interfaces / Contracts

- Storage: `{ "blockingEnabled": boolean }` — missing key ⇒ `true` (A2 default-on intent).
- Message: popup→SW `{type:"toggleBlocking", enabled:boolean}`; SW→popup `{ok:true, enabled:<effective>}` or `{ok:false, error}` — render ack'd effective state, never the requested one.
- Rule entry: `{"id":n,"priority":1,"action":{"type":"block"},"condition":{"urlFilter":"||<domain>^"}}` — unique sequential ids.
- Non-obvious pattern (serialize + collapse rapid toggles; chain is transient, not durable state):

```js
let applying = Promise.resolve();
function applyBlockingState(enabled) {          // sole path writing storage+DNR
  applying = applying.then(async () => {
    await chrome.storage.local.set({ blockingEnabled: enabled });
    const on = (await chrome.declarativeNetRequest.getEnabledRulesets()).includes("ad_rules");
    if (enabled !== on) await chrome.declarativeNetRequest.updateEnabledRulesets(
      enabled ? { enableRulesetIds: ["ad_rules"] } : { disableRulesetIds: ["ad_rules"] });
  });
  return applying;                              // final state = last intent
}
// callers: onInstalled(all) / onStartup / onMessage → applyBlockingState(intent-from-popup)
```

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit (vitest, mocked `chrome.*`) | missing-key⇒true; `applyBlockingState` idempotency; rapid OFF-ON-OFF ⇒ last intent; message handler validation; rules.json shape validator (unique ids, no resourceTypes, valid urlFilter) | pure logic, `test/` |
| Static | lint/format clean; manifest JSON valid | eslint + prettier --check |
| Manual/E2E checklist (Playwright deferred) | **CRITICAL: install→disable→update/reload→STILL DISABLED**; seeded ad script/image blocked on fixture pages, non-seeded pass, main_frame to ad domain loads; toggle both ways immediate; OFF survives restart; popup unknown-state on read failure | fixture HTML + chrome://extensions reload |

## Migration / Rollout

No migration required (greenfield). Dev flow: chrome://extensions → Load unpacked → repo root; the Reload button doubles as an "extension update" reset test. Rollback = revert/delete new files; leftover storage key harmless.

## Open Questions

- [ ] Confirm proposal defaults A1–A5 (CN+global audience, default ON, curated seed, DOM layer deferred, global-off sole escape hatch)
- [ ] Accept manual E2E checklist (Playwright deferred) as MVP verification gate?
- [ ] Final seed domain list curation (assign in tasks)
