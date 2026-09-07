# Tasks: Chrome 广告拦截插件 (MV3 + declarativeNetRequest + popup toggle)

## Phase 1: Infrastructure (toolchain)

- [x] 1.1 Create `package.json` — devDeps eslint (flat config), prettier, vitest; scripts `lint`, `format:check`, `test` (Node 22.19.0 / npm 11.6.2 pinned)
- [x] 1.2 Create `eslint.config.js` (flat config, browser+worker globals) and `.prettierrc`
- [x] 1.3 Create `vitest.config.js` (include `test/`) and `.gitignore` (node_modules, coverage)
- [x] 1.4 Run `npm install`; verify `npm run lint` and `npx vitest --run` execute (0 tests pass is fine)

## Phase 2: Extension skeleton (data)

- [x] 2.1 Create `manifest.json` — MV3; permissions `["declarativeNetRequest","storage"]`, NO `host_permissions`; `background.service_worker: "background.js"`; `action.default_popup: "popup/popup.html"`; `declarative_net_request.rule_resources: [{id:"ad_rules", path:"rules.json", enabled:false}]` (enabled:false is deliberate — SW enables at runtime)
- [x] 2.2 Curate seed domain list, 50–500 entries: CN (Alimama, Baidu Union e.g. `cpro.baidu.com`, Tencent) + major global ad/tracker domains — ad-blocking spec "Seed Covers Major CN and Global Ad Networks"
- [x] 2.3 Create `rules.json` — entry shape exactly `files/rules.example.json`: unique sequential `id`, `priority:1`, `action.type:"block"`, `condition.urlFilter:"||domain^"`, `resourceTypes` omitted (= Chrome default, main_frame unblocked)

## Phase 3: Core logic

- [x] 3.1 Create `background.js` intent/state helpers — read `chrome.storage.local.blockingEnabled` (missing ⇒ `true`); `applyBlockingState(enabled)` per design pseudocode: sole writer of storage+DNR, transient promise-chain collapse so last intent wins, idempotent `updateEnabledRulesets`
- [x] 3.2 Wire `background.js` events — `onInstalled` (ALL reasons, incl. `"update"`) + `onStartup` re-apply stored intent; `onMessage` validates `{type:"toggleBlocking", enabled:boolean}`, applies, acks `{ok:true, enabled:<effective>}` or `{ok:false, error}`
- [x] 3.3 Create `popup/popup.html` + `popup.css` — single toggle control (sole escape hatch per popup-ui "Single Global Toggle") + unknown/failure indication slot
- [x] 3.4 Create `popup/popup.js` — on open read ground truth via `getEnabledRulesets()`, reconcile vs storage intent; read failure ⇒ show "unknown", never a guess (popup-ui "State read unavailable"); toggle sends message, renders ack'd effective state, not requested

## Phase 4: Testing

- [x] 4.1 `test/rules-shape.test.js` — validate `rules.json`: unique sequential ids, no `resourceTypes` key, `urlFilter` matches `||<domain>^`, `action.type:"block"`
- [x] 4.2 `test/background.test.js` (mocked `chrome.*`) — missing key ⇒ true; `applyBlockingState` idempotency (no redundant update call); rapid OFF-ON-OFF settles at last intent (popup-ui "Fast OFF-ON-OFF"); invalid message payload rejected with `{ok:false}`; update-recovery applies on every `onInstalled` reason (extension-shell "OFF survives update")
- [x] 4.3 Create `test/manual-checklist.md` + fixture pages `test/fixtures/*.html` loading seeded-domain sub-resources. Items: install→disable→update/reload→**STILL DISABLED** (extension-shell "OFF survives update"); ON resumes blocking without reload (ad-blocking "ON resumes blocking now"); seeded sub-resource blocked / main_frame nav to seeded domain loads (ad-blocking "Direct navigation…"); OFF survives browser restart (extension-shell "OFF survives browser restart"); popup shows unknown on read failure
- [x] 4.4 Run `npm run lint`, `npx prettier --check .`, `npx vitest --run`; fix findings until green

## Phase 5: Docs

- [x] 5.1 Append dev-load section to `README.md`: chrome://extensions → Load unpacked → repo root; Reload button doubles as update-reset test; note MVP top-domain coverage limitation

Note: repo has zero commits; git baseline is orchestrator-handled, intentionally not a task here.
