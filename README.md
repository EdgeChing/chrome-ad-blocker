# Ad Blocker — Chrome MV3 + declarativeNetRequest

Network-layer ad/tracker blocking from a packaged seed ruleset (`rules.json`, 101 domains, CN +
global), with a one-click global on/off toggle in the popup. No host permissions; no network
rule fetching; the service worker is the sole writer of state (`chrome.storage.local` intent +
`declarativeNetRequest` enabled rulesets).

## Development (one screen)

```bash
npm install          # Node 22.19.0 / npm 11.6.2 (see "engines")
npm run lint         # eslint (flat config)
npm run format:check # prettier — use npm run format to fix
npm test             # vitest run — unit tests in test/ (mocked chrome.*; rules.json shape validator)
```

## Load unpacked (dev flow)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select **this repo
   root**.
2. Open the popup: the single switch is the only control (global on/off).
3. The card's **Reload (⟳)** button doubles as the **update-reset test**: Chrome resets the
   ruleset to the manifest default (`enabled:false`) on reload, then the service worker
   re-derives the stored intent — a saved OFF must survive it (this is the project's CRITICAL
   scenario).
4. Manual verification: follow **`test/manual-checklist.md`** against the fixture page
   **`test/fixtures/ad-page.html`** (seeded sub-resources blocked, control + main-frame
   navigation never blocked).

## Known MVP limitations

- **Top-domain coverage only**: the seed is ~101 hand-curated domains — far from full
  EasyList/EasyList China coverage (community lists are a fast-follow). Requests served from a
  page's own cache never reach the network stack and slip through.
- **No cosmetic layer**: ad placeholders and same-origin ad content stay visible; only
  network requests to seeded domains are blocked.
- Top-level navigation to any domain (including ad domains) is intentionally never blocked.
