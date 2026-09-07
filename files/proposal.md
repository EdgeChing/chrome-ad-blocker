# Proposal: 一个 Chrome 广告拦截插件，Manifest V3，用 declarativeNetRequest 做规则拦截，带一个可以开关拦截的 popup

## Intent

Greenfield MV3 ad-blocker: packaged `declarativeNetRequest` rules block known ad/tracker domains at network layer; popup has a global on/off switch. Scope = design-doc Phase 1 minus DOM-hide层 + simplified global toggle.

## Scope

### In Scope
- `manifest.json` — MV3: permissions `[declarativeNetRequest, storage]`（无 `host_permissions` —纯 block 规则不需要 host permission，见下方 Approach 说明）, service_worker `background.js`, default_popup `popup/popup.html`, rule_resources `{id:"ad_rules", enabled:false, path:"rules.json"}`（初始禁用，由 background.js 在运行时显式启用，见下）
- `rules.json` — static packaged ruleset: ~50–500 curated block domains；explicit priority；`resourceTypes` 不显式设置（省略即为 Chrome 默认行为：除 `main_frame` 外全部资源类型均被拦截，main_frame 导航不受影响，此为官方文档确认的默认值，非需要修复的缺陷）。schema 与示例见随附的 `rules.example.json`
- `background.js` — SW sole writer of `blockingEnabled`（`chrome.storage.local`，default ON per A2）以及 DNR ruleset 启用状态；由于 manifest 中 `rule_resources.enabled` 现为 `false`（每次扩展更新都会重置为 manifest 值，见 Risks），SW 必须在 `onInstalled`（所有 reason）、`onStartup`、以及 popup 消息时，读取 `blockingEnabled` 并调用 `updateEnabledRulesets` 把实际状态**主动同步**为期望状态；这是唯一写入路径，保证幂等
- `popup/{popup.html,popup.css,popup.js}` — one switch reflecting current state

### Out of Scope (follow-ups)
DOM content-script层 (`content.js`, `hide.css`)；remote list loading/auto-update；options page / per-site whitelist；i18n；icons（若未来上架 CWS，需补至少 128x128 图标，MVP 本地测试阶段非必需）。

## Assumptions (open questions Q1–Q5 defaulted; confirm at review)

- A1 Audience: both CN+global → seed includes major Chinese ad networks
- A2 First install: blocking ON（注意：manifest 层 `rule_resources.enabled` 本身设为 `false`，"ON" 是 SW 在 `onInstalled` 时主动启用后达成的状态，不是 manifest 默认值，见 Approach）
- A3 Seed hand-curated now; build-time EasyList/EasyList China parse = fast-follow change
- A4 DOM层 deferred to follow-up change
- A5 MVP false-positive escape hatch = global off only (no per-site whitelist)；resourceTypes 维持省略（= Chrome 默认，main_frame 不拦）

## Approach

Approach 1 — static packaged ruleset + `updateEnabledRulesets(["ad_rules"])` toggle：zero quota churn，浏览器持有规则不依赖 SW 存活；优于 dynamic push 和 session-allow override。Storage = intent；DNR 实际状态由一个幂等的 `applyBlockingState(enabled)` 派生。

**权限最小化**：declarativeNetRequest 的 `block`/`allow` 动作不需要 host permission（仅 `redirect`/`modifyHeaders` 才需要，本提案不涉及），因此 manifest 中不声明 `host_permissions`，降低安装警告面与 CWS 审核阻力。

**Manifest 默认值与更新竞态**：DNR 官方文档明确"enabled 的 static ruleset 集合不跨扩展更新持久化，每次更新都由 manifest 的 `rule_resources` 决定初始值"。因此 manifest 层默认设为 `enabled:false`（安全默认，而非直接写 `true`），真正的开关状态完全由 SW 读取 `chrome.storage.local.blockingEnabled` 后用 JS 显式同步，避免更新瞬间到 `onInstalled` 触发之间出现"manifest 默认值意外生效"的窗口。

## Affected Areas

New files only (greenfield)：`manifest.json`, `rules.json`, `rules.example.json`（示例/文档用途，非运行时依赖）, `background.js` (SW), `popup/`。Content script / options page / remote pipeline (design doc) untouched。

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Enabled-rulesets 每次扩展更新都重置为 manifest 默认值 | High（协议行为，非 bug） | manifest 默认设为 `enabled:false`（安全默认）；`onInstalled("update")` 强制重新读取 storage 并同步真实状态；spec scenario + test: install→disable→update→still disabled |
| SW killed any time — no durable memory state | High | State lives in chrome.storage.local; recover on events/messages only |
| DNR 无法拦截页面自持的 SW/CacheStorage 响应 (SPA ads) | Medium | Accept in MVP, document; DOM-层 follow-up 缓解 |
| Global static-rule quota shared across extensions beyond 30k guarantee | Low (~500 rules) | Track for Phase-2 remote-list change |
| ~500 条规则覆盖率相对 EasyList/EasyList China 全量（约 3-5 万条）极低 | Known limitation | MVP 明确标注为 Top 域名覆盖，非完整拦截；A3 fast-follow 引入完整列表解析 |

## Rollback Plan

All files new → revert = `git revert` of apply commit (or delete the files)；leftover `blockingEnabled` key harmless。

## Dependencies

None at runtime (~500 rules ≪ documented quotas)。Test tooling unconfigured — pin in design/tasks。

## Success Criteria

- [ ] Loads unpacked with no manifest errors; declared permissions only（无 host_permissions）
- [ ] Default ON blocks seeded ad domains at network layer; main_frame navigation unaffected（默认行为，非显式配置）
- [ ] Popup reflects actual state on open; OFF stops blocking immediately, ON resumes without reload
- [ ] Still OFF after extension update/reload and full browser restart (spec scenario + test for update reset)
- [ ] manifest 中 `rule_resources.enabled:false`，实际启用状态完全由 SW 运行时同步得到验证
