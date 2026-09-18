# Exploration: ad-detect-block-toast

Change: `ad-detect-block-toast` — per-site ad detection surfaced in the popup (domain + logo + 🚫-blocked indicator) and a toast prompting the user to block ads that are NOT yet in any blocklist, persisting confirmed domains.

Status of investigation: complete (read-only; no code modified). Web docs were unreachable this session, so exact Chrome quota/API constants are flagged "verify at design" rather than guessed silently.

---

## Current State

### Manifest (`manifest.json`, 12 lines)

- MV3; permissions are exactly `["declarativeNetRequest", "storage"]` (L6). **No** `host_permissions`, **no** `tabs`, **no** `activeTab`, **no** `notifications`, **no** `webRequest`/`webRequestObserver`, **no** `content_scripts`. A repo-wide grep confirms none of these concepts appear anywhere in the shipped code.
- Single static ruleset `{ id: "ad_rules", path: "rules.json", enabled: false }` (L10) — packaged disabled; the SW enables it at runtime from stored intent.
- `action.default_popup = "popup/popup.html"` (L8); background is a plain service worker (L7). No `icons` at all (MVP accepted this).

### Background service worker (`background.js`, 128 lines)

- Sole writer of both durable intent and DNR state. Storage is a **single boolean key** `blockingEnabled` (`STORAGE_KEY`, L15; missing ⇒ `true`, `readStoredIntent`, L25–30). There is **no per-domain blocklist and no list of any kind** stored today.
- `applyBlockingState(enabled)` (L44–69): the one write path — `storage.local.set` → `getEnabledRulesets` → diff → `updateEnabledRulesets({enableRulesetIds|disableRulesetIds})`. Transient `applying` promise chain serializes intents (L22); nothing durable in memory (MV3-kill-safe pattern).
- Re-derives on `onInstalled` (all reasons) + `onStartup` (L81–88) — this exists because Chrome resets *static-ruleset enabled state* to the manifest on every update/reload. (Dynamic rules are NOT reset by updates — they persist across SW death, browser restart, and extension update; verify at design.)
- Message contract is deliberately **strict and singular**: `validateToggleMessage` (L90–110) rejects anything that is not exactly `{type:"toggleBlocking", enabled:boolean}` from `sender.id === chrome.runtime.id` — extra fields are rejected (L105–108), and `onMessage` (L112–128) answers with `{ok:true, enabled}` / `{ok:false, error}`. Any new message type (detection query, block-domain, toast response) requires generalizing this router without weakening it.

### Popup (`popup/`)

- `popup.html` (19 lines): one toggle row + a `#status` line (L10–15). **There is no dropdown/list today** — "the plugin's dropdown" in the user request is a new UI surface that does not exist.
- `popup.js` (141 lines): reads ground truth on open (`chrome.declarativeNetRequest.getEnabledRulesets()` in `refresh()`, L73–106), reconciles toward stored intent, sends only `toggleBlocking` messages (L56–67), never writes storage/DNR directly; honest "unknown" rendering (L41–46). Popup lifetime: its JS dies the moment it loses focus — anything shown must be re-derivable by querying the SW on open (push-only updates would be lost).
- `popup.css` (98 lines): minimal styling; no list styles.

### Seed ruleset (`rules.json`, 101 rules)

- Shape (enforced by `test/rules-shape.test.js` L18–83): `{"id":n,"priority":1,"action":{"type":"block"},"condition":{"urlFilter":"||<domain>^"}}`, ids 1–101 sequential/unique, **`resourceTypes` intentionally omitted** (Chrome default excludes `main_frame` ⇒ top-level navigation never blocked — the "Top-Level Navigation Never Blocked" spec requirement applies to any NEW rules the change adds too).
- Static-rule ids live in the static-ruleset namespace; **dynamic rule ids are a separate namespace**, so new user rules cannot collide with ids 1–101 — but the extension must manage its own unique dynamic ids (e.g., a `nextDynamicRuleId` counter in storage or derive from `getDynamicRules()`).
- Coverage: 101 hand-curated CN+global domains vs ~30–50k in full EasyList/EasyList China ⇒ "ads that loaded but aren't blocked" is, by design, the overwhelming majority. This is the hard core of Feature 2 (see gaps).

### Tests & toolchain

- `test/background.test.js` (321 lines): fully mocked `chrome.*` (storage get/set, DNR get/updateEnabledRulesets, runtime listeners; L23–69). Crucially L252–278 asserts the **exact-shape message rejection matrix** ("unknown message type", "unexpected message fields", untrusted sender ⇒ no mutation). Extending the router must keep every one of these green.
- `vitest` + eslint + prettier configured (`package.json`); no Playwright/E2E yet; `test/manual-checklist.md` + `test/fixtures/ad-page.html` are the manual harness (fixture already fires blocked-seeded, and a non-seeded control request — a good starting canvas for the new features' manual checklist).
- House style: ES5-ish `function` callbacks, promise chains (no async/await), heavy comment contracts, `chrome.storage` as the only durable state.

### Canonical specs — direct conflicts with this change

- `openspec/specs/popup-ui/spec.md` — "Single Global Toggle [A5]" (L9–11): popup MUST present **exactly one** control and it is "the sole false-positive escape hatch (no per-site allowance)". Feature 1 + 2 add list entries and per-domain block affordances ⇒ this requirement MUST be amended (delta spec).
- `openspec/specs/extension-shell/spec.md` — "Minimal Packaged Capability" (L9–11): MUST operate "entirely from capabilities and rule data declared at packaging time; MUST NOT fetch or apply blocking-rule updates from the network". User-confirmed dynamic rules are user data, not network rule updates, so a blocklist survives this requirement — but **remote favicon loading is a runtime network fetch** (asset, not rule) and a content script with host permissions stretches "capabilities declared at packaging time" wording. Needs explicit delta language. "Cosmetic/DOM Layer Out of Scope [A4]" (L61–63) is only OK if this change stays non-cosmetic (detection + prompting, no element hiding) — recommend keeping hiding out of scope.
- `openspec/specs/ad-blocking/spec.md` — "Coverage Boundaries Are Explicit" (L67–69) already acknowledges missed ads; this change is the natural response to that acknowledged gap. Seed requirements stay intact; new user-driven dynamic rules are additive.

### Design-doc context (`D:\Cash Project\test\chrome-ad-blocker-plugin-plan.txt`)

The authoritative plan already prescribes exactly the machinery this change needs: content.js for DOM scanning + MutationObserver (§二, §五.1), `updateDynamicRules` managed by the SW (§二 关键文件职责), heuristic detection of unknown ads (§三C), false-positive control with a "restore/whitelist" gesture (§五.2), and the MV3 pitfalls (SW death ⇒ storage, DNR update batching §七). The MVP consciously deferred all of it (proposal `files/proposal.md` "Out of Scope"); this change picks it up.

---

## Feature 1 gap analysis — per-site ad detection surfaced in the popup

Nothing detects anything today. Candidate mechanisms:

| Mechanism | Sees | Sees ads NOT blocked | Sees already-blocked | Cost / constraints |
|---|---|---|---|---|
| A. `chrome.declarativeNetRequest.getMatchedRules()` (Chrome ≥ 128, same permission we already hold) | Only requests that **matched** a rule | ❌ by definition | ✅ (ruleId, tabId, requestId) | Zero new permissions. BUT: returns `requestId`/`tabId`, **not URLs** — correlating requestId→URL needs webRequest or page-side timing data; store is bounded and ephemeral; verify all of this (docs unreachable this session) |
| B. Content script (the plan-doc route) | All sub-resource load attempts via `PerformanceObserver(resource)` / element `onerror` (failed load ⇒ likely blocked), plus DOM ad-shape heuristics | ✅ (loaded requests visible) | ✅ (failed/canceled loads) | Needs `content_scripts` + `host_permissions <all_urls>` or `activeTab` (activeTab only arms after a user gesture — SPA-late loads and auto-redirects may escape it; verify). Also the only vehicle for a **nice in-page toast** (Feature 2) |
| C. `webRequestObserver` in SW (Chrome ≥ 121) | Every request/response incl. result + tabId + initiator | ✅ | ✅ | New `webRequestObserver` permission + host permissions; heavier install warnings; no DOM context |

- **Ledger & lifecycle**: per-tab detected-ad entries must survive popup close and possible SW death between popup opens ⇒ `chrome.storage.session` keyed by tabId (in-memory-across-SW-restarts, cleared at browser exit — matches "current site" semantics; the blocklist itself goes to `storage.local`). Popup queries `{type:"getDetectedAds", tabId}` on open via `chrome.tabs.query({active:true,currentWindow:true})` (⇒ needs `tabs` permission, or `activeTab` — verify which is sufficient for `query` metadata reads).
- **Blocked-vs-not indicator (🚫)**: derivable by matching each detected host against (a) the seed static rules when the ruleset is enabled, and (b) the user blocklist — a pure `urlFilter`⇄host comparison; no DNR log strictly required. DNR "blocked" only occurs when the ruleset is enabled ⇒ if the toggle is OFF, honest UI shows nothing as blocked.
- **Logos/favicons**: remote images in the popup are allowed by default MV3 CSP (default restricts `script-src`/`object-src`, not `img-src` — verify), so `<img src="…favicon…">` works; but the spec scenario "Offline operation" (extension-shell L13–17) must not break ⇒ `onerror` fallback to a locally-drawn domain initial / generic glyph. Options: page's `tab.favIconUrl` (needs `tabs` permission; without it the field is omitted), a public favicon proxy (adds a third-party network dependency + privacy concern — the design doc §五.4 says no telemetry/no unnecessary exfil by default; pinging Google's s2 for every detected ad host is itself a tracking signal), or fully offline generic icons per domain hash (zero perms, zero network, uglier). Recommend: generic local glyph as default, `tab.favIconUrl` if `tabs` is granted; do NOT ship a remote favicon fetcher without a product decision.

## Feature 2 gap analysis — toast asking to block new ads

- **Injection today: none.** A Chrome-side "toast" (system notification via `chrome.notifications`) needs the `notifications` permission and a click/button flow; it is desktop-level, not page-adjacent. An **in-page toast** (a small DOM overlay from the content script) gives the best UX and is what the plan-doc content.js layer enables; note the popup cannot be the toast (it's closed until the user opens it). Badge + popup-list-only is the third, most conservative option.
- **"Ad not in blocklist that loaded" = currently-missed ad** — the interpretation to confirm with the user: it necessarily means ads matched by NO rule (Feature 2 targets the blocker's own gaps). Detecting them requires a **classifier**, since DNR is silent about non-matches. Realistic MVP classifiers: (i) request host is third-party w.r.t. the page and its hostname/URL matches ad-like patterns (`ad|ads|banner|track|doubleclick|pop|infeed` …), (ii) hosts resembling the seed's known ad networks not yet listed, (iii) DOM heuristics from the plan doc §三C (fixed/sticky overlays, iframe ad shapes). All are heuristic ⇒ false-positive risk is the defining product risk of this change.
- **Confirm flow** (feasible with current permissions except who asks): content script or notification click → SW message `{type:"blockHost", host}` → SW appends host to durable `storage.local` list (e.g. `userBlockedHosts: string[]` + host→dynamicRuleId map) → `updateDynamicRules` adds `{ id: nextDynamicId, priority: <higher than seed's 1>, action:{type:"block"}, condition:{ urlFilter:"||<host>^" /* resourceTypes omitted = main_frame safe, same as seed */ } }` → ack. Dynamic rules persist across update/restart (unlike the enabled-rulesets reset the SW already handles at L81–88), so no new re-derivation choreography is needed for them — but **idempotency and dedupe** matter (never add a host twice; reject first-party/page hosts — blocking the site's own domain would break it, mirroring the plan-doc §五.2 false-positive discipline). Also: blocking applies to **future requests** (SPA re-render / next visit), not to the already-painted creative; the toast should either also visually remove the just-loaded element (that IS a cosmetic action — needs a scope call vs spec A4) or say "will be blocked from now on; reload to see".
- **Rate limiting**: cap prompts (e.g. one toast per host per session, N per tab) — stored in `storage.session` with the ledger.

## Quotas & unknowns (verify against official docs at design time — fetch failed this session)

- `updateDynamicRules`: total dynamic(+session?) rule cap commonly cited as ~5,000 (`MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES`); per-call add/remove caps and "rule ids must be unique" semantics; static enabled-ruleset count cap (irrelevant to MVP). 5,000 is far above any plausible MVP user blocklist; batching only needed if the fast-follow remote-list change lands later (plan doc §七 says 512/call — also verify).
- `getMatchedRules` availability (Chrome 128+), its requestId↔URL correlation gap, and log size bound.
- `chrome.storage.session` surviving SW restarts but not browser restarts (and default access level = trusted contexts ⇒ SW/popup only, not content scripts — messages must relay).
- Whether opening the popup grants `activeTab` to the active tab (affects whether content-script injection is even legal without `host_permissions`) — assume NOT; if true, detection without host permissions is limited to the notification-only approach.
- `declarativeNetRequest.getAvailableStaticRuleCount()` exists; there is no equivalent dynamic-quota query — track usage locally.

---

## Affected Areas

- `manifest.json` — permissions list (L6) grows: at minimum `tabs` or `activeTab` for tab targeting; likely `notifications` (toast option E) and/or `content_scripts` + `host_permissions <all_urls>` (options B/F — the plan-doc path); DNR section unchanged.
- `background.js` — message router generalization (`validateToggleMessage` L90–110, `onMessage` L112–128) to a type-dispatched strict validator; new user-blocklist + dynamic-rule application module (mirror the `applying` serialization idiom, L22, L44–69); per-tab detection ledger (`storage.session`); toast decision logic + rate limits; optional badge updates (`chrome.action.setBadgeText`).
- `popup/popup.html` — new detected-ads section (list/dropdown with favicon, host, 🚫-blocked badge, per-entry "Block this ad source" action) below the existing toggle row (L9–16).
- `popup/popup.js` — extend `refresh()` (L73–106) with a second query round-trip for per-tab detected ads; render list; block-button messages; offline-safe icon fallback.
- `popup/popup.css` — list/badge/button styles.
- `content.js` (new) + maybe `content.css` — resource observer, ad heuristics, ledger reporting, in-page toast (if the content-script approach is chosen).
- `test/background.test.js` — keep the L252–278 rejection matrix green; add mocks for `updateDynamicRules`/`getDynamicRules`, `tabs`, `notifications`/`action`; new suites for blockHost flow + ledger + idempotency.
- `test/rules-shape.test.js` — unchanged (seed stays), unless a shared "rule factory" util gets its own shape test.
- `test/fixtures/ad-page.html`, `test/manual-checklist.md` — extend: a non-seeded "ad-like" host to trigger Feature 2, expected toast + popup-list assertions.
- `openspec/specs/{popup-ui,extension-shell,ad-blocking}/spec.md` — deltas required: popup "exactly one control" (A5), "Minimal Packaged Capability", "Cosmetic/DOM Layer Out of Scope [A4]" wording, and a new requirement for user-confirmed dynamic blocklist behavior.

## Approaches

1. **Option B+F: content-script detect + in-page toast** (plan-doc aligned)
   - Pros: only combo that fully satisfies both features (sees unblocked ads, page-adjacent toast, request-error ⇒ blocked evidence, matches the authoritative design doc's dual-layer roadmap); popup stays read-mostly.
   - Cons: `host_permissions <all_urls>` (+ maybe `tabs`/`notifications`) — big install warnings; breaks the "packaged capability"/A4 spec framing unless amended; DOM heuristics = false-positive + performance surface; largest test scope.
   - Effort: High.
2. **Option C(+E): `webRequestObserver` in SW + `chrome.notifications` toast, popup list** (no page injection)
   - Pros: accurate network-level view incl. blocked-vs-loaded per tab; zero content scripts, zero DOM perf/privacy surface; ledger + popup straightforward; notifications permission is mild.
   - Cons: still `webRequestObserver` + host permissions (warnings comparable to B!); toast is desktop-level, not near the ad; no DOM-shape detection (misses same-origin/inline "content ads"); system-notification UX is declining.
   - Effort: Medium.
3. **Option A(+D): DNR `getMatchedRules` + badge + popup list only, no toast** (permission-minimal)
   - Pros: no new permissions beyond maybe `tabs`; honest Feature-1 list of *blocked* sources (🚫 indicator natural); tiny diff.
   - Cons: cannot see ads that loaded unblocked ⇒ **Feature 2 essentially unimplementable** (only "what we already caught"); requestId→URL correlation gap.
   - Effort: Low — but does not meet the user request.
4. **Option 2/1 hybrid staged delivery**: ship A-lite ledger + popup list + notification toast first (no content script), add content-script in-page toast as a second change.
   - Pros: honors spec-delta discipline (each requirement amendment lands with its feature); user sees value early; permission creep split across releases.
   - Cons: two SDD cycles; toast UX weaker in phase 1.

## Recommendation

The user request explicitly asks for detection of ads that **loaded** (⇒ they were not blocked) and an interactive **toast** — that rules out Option 3 as a whole; the realistic contest is Option 1 vs 2, both of which cost host-level permissions. Recommend **Option 1 (content-script + in-page toast)**, aligned with the authoritative design doc's dual-layer architecture, with hard constraints carried over from existing specs: keep it **detection + prompting only, no cosmetic hiding** (preserves A4 spirit — the in-page toast is the sole UI element injected), first-party hosts never offered for blocking, `resourceTypes` omitted on user rules (main_frame safety), per-host once-per-session toast rate limit, blocklist in `storage.local` as durable intent mirrored into dynamic rules through the existing single-writer/serialization idiom, ledger in `storage.session`. If the reviewer balks at `<all_urls>`, fall back to Option 2 (observer + notifications) or the staged Option 4. The proposal must enumerate the three spec deltas (popup-ui A5, extension-shell packaged-capability + A4 boundary, ad-blocking user-rule layer) up front.

## Risks

1. **Ad classification false positives** — "not in any blocklist" ads are recognizable only heuristically; wrong toasts train users to distrust the extension. Mitigate: conservative URL-pattern classifier + third-party-only gate + per-host rate limit + dismiss-don't-ask-again.
2. **Permission expansion vs spec & store** — content-script/observer approaches require `host_permissions` (or equivalent), contradicting the current "Minimal Packaged Capability" spec and CWS review posture; decision needed in proposal, not silently.
3. **DNR dynamic-rule quotas/id management** — 5k-scale cap, unique-id bookkeeping, idempotent add, update batching; exact constants unverified this session (docs fetch failed) — verify before design.
4. **Lifecycle traps** — popup closed ⇒ no push (must be query-on-open); SW death mid-toast flow ⇒ ledger in `storage.session`, blocklist in `storage.local`; already-loaded creative isn't retroactively removed (set user expectations in copy).
5. **Three canonical specs need amendments** (popup-ui "Single Global Toggle", extension-shell packaged-capability/A4, ad-blocking coverage) — scope creep risk: this change is the MVP's first true architectural expansion; keep hiding/remote-lists/i18n explicitly out of scope.

## Ready for Proposal

**Yes.** Decide at proposal start (or ask the user): (1) content-script in-page toast vs observer+notification (recommend former per design doc); (2) whether the confirmed-block toast may visually remove the current ad instance or must wait for reload; (3) favicon policy (local glyph vs tab.favIconUrl vs remote fetch). Everything else is implementable within MV3 given current APIs; no fundamental blocker found.
