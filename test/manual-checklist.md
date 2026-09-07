# Manual Test Checklist — Ad Blocker (MV3 + declarativeNetRequest + popup toggle)

Companion to `test/fixtures/ad-page.html`. Each item is keyed to the spec scenario(s) it
verifies. Scenario names are quoted verbatim from
`openspec/changes/…/specs/{ad-blocking,extension-shell,popup-ui}/spec.md`.
Fast OFF-ON-OFF convergence and message-contract validation are additionally covered by unit
tests (`npx vitest --run`); do the manual passes below for real-browser network behavior.

**Legend**: every “blocked” observation = DevTools → Network row shows
`net::ERR_BLOCKED_BY_CLIENT` and/or a `(blocked:ad_rules)` / “blocked by extension” note on the
request. A DNS error or 404 is **not** blocked — the distinction matters when the page is OFF.

## Setup

1. **Load unpacked** — `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select the **repo root** (`chrome-ad-blocker/`). The card shows “Ad Blocker 0.1.0” with no
   errors. _(extension-shell: “Minimal Packaged Capability” — everything ships packaged.)_
2. **Fixture** — open `test/fixtures/ad-page.html` (via `file://` is fine; if file-scheme
   requests behave oddly, serve the repo with any static server, e.g. `npx serve .`, and open
   `http://localhost:3000/test/fixtures/ad-page.html`). Open its DevTools → Network, keep it
   filtered onImg/JS.

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

## Sign-off

- [ ] All items 1–18 pass, with item **13 (CRITICAL)** explicitly witnessed.
- Record Chrome version + OS below: ______________________
