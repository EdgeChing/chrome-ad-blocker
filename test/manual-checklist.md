# Manual Test Checklist — Ad Blocker (MV3 + declarativeNetRequest + popup toggle + detect-toast)

Companion to `test/fixtures/ad-page.html`. Each item is keyed to the spec scenario(s) it
verifies. Scenario names are quoted verbatim from
`openspec/changes/…/specs/{ad-blocking,extension-shell,popup-ui}/spec.md`.
Fast OFF-ON-OFF convergence and message-contract validation are additionally covered by unit
tests (`npx vitest --run`); do the manual passes below for real-browser network behavior.

> **Release note (ad-detect-block-toast):** this change adds the `tabs` permission and
> `host_permissions: ["<all_urls>"]` (page-scoped detection + toast). **Existing installs see
> elevated-permission warnings on update, and the Chrome Web Store may require re-consent** —
> call this out in the store listing / release notes before publishing.

**Legend**: every “blocked” observation = DevTools → Network row shows
`net::ERR_BLOCKED_BY_CLIENT` and/or a `(blocked:ad_rules)` / “blocked by extension” note on the
request. A DNS error or 404 is **not** blocked — the distinction matters when the page is OFF.

## Setup

1. **Load unpacked** — `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select the **repo root** (`chrome-ad-blocker/`). The card shows “Ad Blocker 0.1.0” with no
   errors. _(extension-shell: “Minimal Packaged Capability” — everything ships packaged.)_
2. **Fixture** — **serve the repo over http**: `npx serve .` and open
   `http://localhost:3000/test/fixtures/ad-page.html`. Plain `file://` is fine for the seeded
   network checks below, but **`file://` gets NO content script** — every toast/detection item
   (19+) REQUIRES the http origin. Open its DevTools → Network, keep it
   filtered on Img/JS.

## Fresh install & default ON

3. **Default-on after install** — with the extension freshly loaded and the popup **never
   opened**: the fixture page's `doubleclick.net` and `cpro.baidu.com` requests are already
   blocked; `example.com` loads. Open the popup → toggle reads **ON** (“Blocking is on.”).
   _(extension-shell: “First-Install Default Is Blocking ON” [A2]; ad-blocking: “Ad asset
   blocked”, “Non-matching request passes”.)_
4. **Offline operation** — DevTools → Network → **Offline** (or disconnect network), reload the
   fixture, open the popup: no errors; state renders; toggle still works (DNR is packaged, not
   fetched). Return online. _(extension-shell: “Offline operation”.)_

## Seeded blocking (fixture, blocking ON)

5. **Ad asset blocked / Global tracker blocked** — press the fixture's **Re-fire** button:
   `doubleclick.net` request = blocked; rest of page unaffected. _(ad-blocking.)_
6. **Known CN network blocked** — same fire: `cpro.baidu.com` script = blocked.
   _(ad-blocking: seed covers Baidu Union / CN networks.)_
7. **Direct navigation to an ad-domain URL** — type `https://doubleclick.net/` in the address
   bar (or click the fixture's nav link): the **main-frame document navigation is NOT blocked**
   (no `ERR_BLOCKED_BY_CLIENT` on the document row; a DNS/TLS/404 result is fine — the point is
   the user reaches/requests the page itself; any sub-resources inside stay blocked).
   _(ad-blocking: “Top-Level Navigation Never Blocked”.)_
8. **Visible residue acknowledged** — the fixture's `[ AD PLACEHOLDER ]` box still renders while
   ON. Accepted MVP limitation, not a bug. _(extension-shell: “Cosmetic/DOM Layer Out of
   Scope”; ad-blocking: “SPA self-served content acknowledged”.)_

## Toggle both ways, no reload

9. **OFF stops blocking now** — leave the fixture open. Popup → flip **OFF**. Press **Re-fire**:
   `doubleclick.net` / `cpro.baidu.com` now produce normal network results (NOT
   `ERR_BLOCKED_BY_CLIENT`). No page reload performed. _(ad-blocking: “OFF stops blocking now”;
   popup-ui: “User disables blocking”.)_
10. **ON resumes blocking now** — popup → flip **ON**. Press **Re-fire**: seeded requests are
    blocked again, still no reload. _(ad-blocking: “ON resumes blocking now”.)_
11. **Escape hatch** — the OFF state above is the only false-positive escape hatch (no per-site
    list this version): with OFF, a page that broke due to a seeded host loads its seeded
    sub-resources again. _(popup-ui: “Escape hatch for a broken page”.)_
12. **Fast OFF-ON-OFF** (spot check; unit-tested) — flip the popup switch OFF-ON-OFF rapidly,
    close the popup, reopen it: control reads **OFF** and the fixture's re-fired seeded
    requests load normally (final state = last intent, no leftovers). _(popup-ui: “Rapid
    Successive Toggling Converges to Last Intent”.)_

## CRITICAL — persistence across update/reload and restart

13. **⚠️ CRITICAL — OFF survives update (= reload)** — the single most important check: Chrome
    resets the ruleset to the manifest's `enabled:false` on every update/reload, and the
    service worker must re-derive state from the stored intent **without ever flipping a stored
    OFF back ON**. Steps:
    1. Popup → set **OFF**.
    2. `chrome://extensions` → **Reload (⟳)** the extension — this is the update-reset proxy.
    3. Verify ALL of: popup re-opened reads **OFF** (“Blocking is off.”, switch unchecked);
       SW console (`inspect Views: service worker` →
       `chrome.declarativeNetRequest.getEnabledRulesets()` → `[]`, i.e. `ad_rules` NOT enabled);
       fixture re-fire → seeded requests load normally (not blocked).
       _(extension-shell: “Effective State Re-Derived After Extension Update or Reload”,
       “OFF survives update”; popup-ui: “Reopen after update re-derivation”.)_
14. **ON survives update** — repeat with **ON**: after reload, popup reads ON and seeded fixture
    requests are blocked again. _(extension-shell: “ON survives update”.)_
15. **OFF survives browser restart** — set **OFF**, fully quit Chrome (confirm no chrome
    processes remain), relaunch, open the fixture and re-fire: seeded requests load normally;
    popup reads OFF. _(extension-shell: “OFF survives browser restart”.)_
16. **ON survives browser restart / Choice restored** — same with **ON**: first page load blocks
    seeded requests with no user action. _(extension-shell: “ON survives browser restart”,
    “Intent Is the Durable Source of Truth”.)_

## Popup honesty

17. **State read unavailable ⇒ “unknown”** — the popup must never guess. Two ways to force:
    - **Live check**: in a temporary local copy, remove `"declarativeNetRequest"` from
      `manifest.json → permissions`, reload the extension, open the popup → it shows
      **“Status unavailable — could not read the blocking state.”** with the switch disabled —
      not a confident ON/OFF. Revert the manifest afterwards (do **not** commit this tweak).
    - **Code-review check**: `popup/popup.js` `refresh()` rejects the
      `getEnabledRulesets()` path into `renderUnknown()` (disables control, explicit message);
      no `catch` guesses a default.
      _(popup-ui: “Non-Misleading When State Cannot Be Read or Applied”, “State read
      unavailable”.)_
18. **Applied change unconfirmed** — with the service worker killed (chrome://extensions →
    “service worker” → stop) and network throttled, flip the switch and let the message round-trip
    fail (or temporarily break `sendToggle`): the popup restores the previous effective position
    and shows the error line — it never shows the requested state as if applied. Reopen popup →
    ground truth re-read. _(popup-ui: “Applied change unconfirmed”.)_

## Detection toast & user-confirmed blocks (http origin required — items 19–27)

19. **Toast appears once per host per session** — fresh http fixture page, blocking ON: within a
    few seconds a dark toast bottom-right names `cdn.adstats-lab.net` (or the tab-local ad source)
    and states blocking starts **at the next reload — won't remove this one**. Press the fixture's
    **Re-fire** button repeatedly: NO second toast for the same host this session.
    _(ad-blocking: “Once per host per session”.)_
20. **Dismiss sticks** — press × (or wait ~8 s for auto-dismiss): toast disappears; re-fire: it
    does NOT come back this session. _(ad-blocking: “Once per host per session”.)_
21. **Confirm swaps the ack honestly** — re-open the page in a new tab (new session) or use a
    second unseeded ad-pattern URL; press **Block** in the toast: the message swaps to the
    confirmation (“will be blocked starting at the next reload”). Failures (e.g., stop the SW to
    force it) show the error text instead — never a fake confirmation.
    _(ad-blocking: “User-Confirmed Dynamic Blocklist”; popup honesty.)_
22. **Confirm blocks on reload** — after confirming, reload the fixture: the confirmed host's
    request now reports `ERR_BLOCKED_BY_CLIENT` / `(blocked:…)`; the rest of the page still loads.
    Before confirming it never was blocked (non-retroactivity). _(ad-blocking: “Confirm blocks on
    reload”.)_
23. **Survives restart, deduped** — fully quit Chrome, relaunch, open the popup: the confirmed
    host is listed with 🚫; DevTools Network on re-fire still blocked; in the SW console
    `chrome.declarativeNetRequest.getDynamicRules()` shows EXACTLY ONE rule for the host (id
    ≥ 1000, `urlFilter "||<host>^"`, no `resourceTypes`). Confirming again adds nothing.
    _(ad-blocking: “Persist and dedupe”.)_
24. **Popup shows detections** — open the popup on the fixture tab: “Detected ad sources” lists
    the domains seen on that tab with the page favicon (or a local letter glyph offline), 🚫 on
    blocked ones only, a **Block** button on unblocked ones. Other tabs show only their own
    detections. _(popup-ui: “List on open”, “Per-tab isolation”, “Favicon unreachable”,
    “Offline retained”.)_
25. **First-party never offered** — nothing from the page's own origin (same registrable domain,
    including `*.localhost` oddities or `example.com` vs `notexample.com` confusion) ever appears
    as a toast or in the list. _(ad-blocking: “Conservative gate rejects”; popup-ui: first-party
    never offered.)_
26. **OFF respected end-to-end** — flip the popup toggle OFF with confirmed user hosts present:
    popup shows NO 🚫 anywhere; SW console `getDynamicRules()` returns `[]` (user rules removed
    while OFF); toasts stop. Flip ON: 🚫 returns, user rules re-created at ids ≥ 1000 (self-heal).
    _(popup-ui: “Master toggle OFF respected”, “Global control count unchanged”; ad-blocking
    semantics D5.)_
27. **Toast is the only injection (A4)** — confirm or dismiss; DevTools → Elements: the page's own
    DOM/CSS is untouched before, during, after (the toast lives in a closed shadow root that is
    fully removed on dismiss; already-visible ads intentionally REMAIN — cosmetic layer out of
    scope). _(extension-shell: “Sole Injected UI Is the Confirm Toast”, “No cosmetic action”.)_

## Sign-off

- [ ] All items 1–27 pass, with item **13 (CRITICAL)** explicitly witnessed.
- Record Chrome version + OS below: ______________________
