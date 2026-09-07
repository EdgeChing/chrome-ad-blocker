# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

See `_shared/skill-resolver.md` for the full resolution protocol.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| When creating a pull request, opening a PR, or preparing changes for review | branch-pr | C:\Users\Admin\.config\opencode\skills\branch-pr\SKILL.md |
| When writing Go tests, using teatest, or adding test coverage | go-testing | C:\Users\Admin\.config\opencode\skills\go-testing\SKILL.md |
| When creating a GitHub issue, reporting a bug, or requesting a feature | issue-creation | C:\Users\Admin\.config\opencode\skills\issue-creation\SKILL.md |
| When user says "judgment day", "judgment-day", "review adversarial", "dual review", "doble review", "juzgar", "que lo juzguen" | judgment-day | C:\Users\Admin\.config\opencode\skills\judgment-day\SKILL.md |
| When user asks to create a new skill, add agent instructions, or document patterns for AI | skill-creator | C:\Users\Admin\.config\opencode\skills\skill-creator\SKILL.md |

## Compact Rules

Pre-digested rules per skill. Delegators copy matching blocks into sub-agent prompts as `## Project Standards (auto-resolved)`.

### branch-pr
- Every PR MUST link an approved issue (`Closes`/`Fixes`/`Resolves #N`) and the linked issue MUST carry `status:approved`; CI blocks unlinked or unapproved PRs
- Branch names MUST match `^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)/[a-z0-9._-]+$` — lowercase, no spaces
- Commits MUST be conventional: `type(scope): description` with type in build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test; append `!` for breaking changes
- Exactly ONE `type:*` label per PR: bug→`type:bug`, feat/perf→`type:feature` (or `type:breaking-change` when `!`), docs/refactor/chore/style/test/build/ci map to same-named labels
- Run `shellcheck` on any modified `.sh` scripts before pushing
- Never add `Co-Authored-By` trailers; fill the PR template at `.github/PULL_REQUEST_TEMPLATE.md` (linked issue, type checkbox, summary, changes table, test plan)

### go-testing
- Pure functions → table-driven tests: struct slice of cases (`name`, input, expected, `wantErr`) with one `t.Run(tt.name, ...)` per case
- Always assert error path first: `if (err != nil) != tt.wantErr { t.Errorf(...); return }` before checking values
- Bubbletea state changes → call `m.Update(msg)` directly and assert on the returned model; type-assert back to the concrete Model
- Full TUI flows → `teatest.NewTestModel(t, m)`, `tm.Send(tea.KeyMsg{...})`, `tm.WaitFinished(t, teatest.WithDuration(...))`, then `tm.FinalModel(t)`
- Visual output → golden files under `testdata/` (regenerate with an `-update` build/test flag)
- Use `t.TempDir()` for file operations; mock `os/exec` behind interfaces; real-command tests skip under `-short`

### issue-creation
- Blank issues are disabled — MUST use a template (`bug_report.yml` or `feature_request.yml`); questions belong in Discussions, never issues
- Search existing issues for duplicates first (`gh issue list --search "keyword"`) and fill ALL required fields plus pre-flight checkboxes before submitting
- New issues auto-get `status:needs-review`; NO PR may be opened until a maintainer adds `status:approved`
- Bug reports require description, numbered repro steps, expected vs actual behavior, OS/agent/shell context; feature requests require problem, proposed solution, affected area

### judgment-day
- The orchestrator NEVER reviews code itself — launch TWO blind judge sub-agents in parallel via async delegate with identical prompts; neither judge knows about the other
- BEFORE launching judges: resolve compact rules from `.atl/skill-registry.md` by code context (file extensions/paths) AND task context, then inject a `## Project Standards (auto-resolved)` block into both judge prompts and the fix agent prompt
- Synthesize only after BOTH judges return: confirmed = found by both; suspect = single-judge finding (report but never auto-fix); contradiction = flag for manual decision
- The Fix Agent is always a separate delegation that fixes ONLY confirmed issues — no refactoring beyond the strict fix, no touching unflagged code
- Re-judge in parallel after each fix round; hard limit of 2 fix iterations, then return JUDGMENT: ESCALATED with full history

### skill-creator
- Layout: `skills/{name}/SKILL.md` plus optional `assets/` (templates/schemas) and `references/` (LOCAL file paths only — never web URLs)
- Frontmatter is mandatory: `name`, `description` containing a `Trigger:` line, `license: Apache-2.0`, `metadata.author: gentleman-programming`, `metadata.version` as a quoted string
- Naming conventions: `{technology}`, `{project}-{component}`, or `{action}-{target}` — lowercase hyphenated
- Body: critical patterns first, tables for decision trees, minimal focused code examples; NO Keywords section, no troubleshooting dumps, never duplicate existing docs (reference them instead)
- Register every new skill by adding a row to the `AGENTS.md` skills table

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| (none found) | — | No agents.md / AGENTS.md / CLAUDE.md / .cursorrules / GEMINI.md / copilot-instructions.md in project root (`D:\Cash Project\chrome-ad-blocker`) or workspace git root (`D:\Cash Project`) |

Design reference (not a convention file, but the authoritative design doc for this project — read before spec/design phases):
- `D:\Cash Project\test\chrome-ad-blocker-plugin-plan.txt` — Chinese-language design plan for the Chrome MV3 ad-blocker extension: dual-layer architecture (declarativeNetRequest network blocking + DOM content-script cleanup), service-worker background with dynamic DNR rules, MutationObserver-based SPA handling, rule-list sources (AdGuard/EasyList/EasyList China), 4-phase MVP roadmap, known pitfalls (MV3 SW lifecycle, DNR update quotas).
