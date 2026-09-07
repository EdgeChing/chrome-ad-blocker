# Archive Report

**Change**: 一个 Chrome 广告拦截插件，Manifest V3，用 declarativeNetRequest 做规则拦截，带一个可以开关拦截的 popup
**Project**: chrome-ad-blocker
**Archived**: 2026-09-01 (sdd-archive)
**Artifact store**: orchestrator declared `engram`, but Engram (`mem_search`/`mem_get_observation`/`mem_save`) is **not available in this session** (no Engram MCP tools in the agent toolset; no Engram server in `opencode.jsonc`; no `engram` CLI or data dir). Artifacts lived on the filesystem under `openspec/` the entire cycle, so archive was executed per the OpenSpec convention and this file is the audit trail. **No Engram observation IDs exist** — filesystem paths below are the traceable identifiers.

## Pre-archive gate (verify-report)

- Verdict: **PASS WITH WARNINGS** — zero CRITICAL issues → archive permitted (skill rule: never archive with CRITICAL issues; warnings do not block).
- Tasks: 16/16 complete. Gates re-executed by sdd-verify: vitest 33/33, eslint 0, prettier 0.
- Spec compliance: 23/23 scenarios with evidence (18 automated, 5 manual-checklist/code-reading).

## Lineage — artifacts and locations

All paths relative to repo root. Pre-move location: `openspec/changes/一个 Chrome 广告拦截插件，Manifest V3，用 declarativeNetRequest 做规则拦截，带一个可以开关拦截的 popup/`; post-move: `openspec/changes/archive/2026-09-01-<same name>/`.

| Artifact | Expected topic key (engram, N/A here) | Filesystem lineage ID |
|----------|----------------------------------------|---------------------|
| Exploration | `sdd/{change}/explore` | `<change>/exploration.md` |
| Proposal | `sdd/{change}/proposal` | `<change>/proposal.md` |
| Spec (delta, 3 domains) | `sdd/{change}/spec` | `<change>/specs/{ad-blocking,extension-shell,popup-ui}/spec.md` |
| Design | `sdd/{change}/design` | `<change>/design.md` |
| Tasks | `sdd/{change}/tasks` | `<change>/tasks.md` (16/16 `[x]`) |
| Apply progress | `sdd/{change}/apply-progress` | `<change>/apply-progress.md` (batches 1–3) |
| Verify report | `sdd/{change}/verify-report` | `<change>/verify-report.md` |
| Archive report | `sdd/{change}/archive-report` | `<change>/archive-report.md` (this file) |

## Specs synced to source of truth

`openspec/specs/` was empty (no main specs) and all three delta specs are full specs (no ADDED/MODIFIED/REMOVED markers), so each was copied byte-identically (`rules.archive`: no destructive merge → no warning required). SHA-256 source↔destination verified equal at sync time.

| Domain | Action | Details |
|--------|--------|---------|
| ad-blocking | Created | 5 requirements, 8 scenarios (seeded-domain blocking, nav never blocked, immediate toggle effect, CN+global seed, coverage boundaries) |
| extension-shell | Created | 5 requirements, 7 scenarios (minimal packaged capability, default ON, durable intent, **CRITICAL** update/reload re-derivation, cosmetic layer out of scope) |
| popup-ui | Created | 5 requirements, 8 scenarios (single global toggle, actual-state-on-open, persistence, rapid-toggle convergence, non-misleading failure states) |

## Archive contents (audit trail — never delete or modify)

proposal.md ✅ · exploration.md ✅ · design.md ✅ · tasks.md ✅ (16/16) · apply-progress.md ✅ (3 batches) · verify-report.md ✅ · specs/ ✅ (3 domains) · archive-report.md ✅

## Implementation outcome (summary)

MV3 extension shipped in-repo: `manifest.json` (permissions exactly `[declarativeNetRequest, storage]`, rule_resources `ad_rules` `enabled:false` by design), `rules.json` (101 curated CN+global block domains, `urlFilter "||domain^"`, no `resourceTypes`), `background.js` (SW sole writer; idempotent `applyBlockingState`; re-apply on `onInstalled` all reasons + `onStartup` + validated toggle message with effective ack), `popup/*` (renders ground truth / ack'd effective, unknown-state on read failure), tests (`test/rules-shape.test.js`, `test/background.test.js`, `test/manual-checklist.md` + fixture), toolchain pinned (eslint flat + prettier + vitest; Node 22.19.0 / npm 11.6.2), README dev-load docs.

## Carried forward to next change (from verify warnings/suggestions — non-blocking)

1. No automated tests for `popup/popup.js` (suggest vitest+jsdom fast-follow).
2. **Manual checklist items 1–18 not yet signed off** (real browser required; ⚠️ includes CRITICAL item 13 update-recovery live witness) — user must execute before release.
3. Suggestions: checklist typo fix ("filtered on Img/JS"), indeterminate visual for `renderUnknown()`, shared-constants extraction if module format allows.
4. Deferred roadmap items from proposal A3/A4: EasyList/EasyList China build-time parser, DOM/cosmetic layer, remote list updates, per-site whitelist, CWS icons, Playwright E2E.
