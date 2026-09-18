// Tasks 2.6 (+2.1–2.3 verification) — service-worker logic under test with mocked
// chrome.*, via the shared harness (test/sw-harness.js).
// Asserts against the NORMATIVE contracts in design.md "Interfaces / Contracts"
// + pseudocode — NOT the illustrative Data Flow ASCII (whose shorthand
// `updateEnabledRulesets({disable:[...]})` is wrong). Real API names:
//   updateEnabledRulesets({ enableRulesetIds | disableRulesetIds })
//   storage {"blockingEnabled":boolean}, missing => true
//   message {type:"toggleBlocking", enabled:boolean}; ack {ok:true,enabled} | {ok:false,error}
// New-type rejection strings are new strings; the legacy toggle matrix below — and
// its exact rejection strings — are UNCHANGED by this change.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXT_ID, RULESET, contentSender, send, settle, toggleMsg } from "./sw-harness.js";
import { loadSw } from "./sw-harness.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("First-Install Default Is Blocking ON (extension-shell [A2])", () => {
  it("missing storage key => intent true: onInstalled enables the ruleset via enableRulesetIds", async () => {
    const env = await loadSw({ rulesets: [] }); // manifest ships enabled:false; storage untouched
    env.listeners.onInstalled[0]({ reason: "install" });

    await settle();
    expect(env.updateEnabledRulesets).toHaveBeenCalledTimes(1);
    expect(env.updateEnabledRulesets).toHaveBeenCalledWith({ enableRulesetIds: [RULESET] });
    expect(env.store.blockingEnabled).toBe(true); // intent materialized
    expect(env.enabled.has(RULESET)).toBe(true);
  });

  it("missing storage key => intent true on onStartup too", async () => {
    const env = await loadSw({ rulesets: [] });
    env.listeners.onStartup[0]();

    await settle();
    expect(env.updateEnabledRulesets).toHaveBeenCalledTimes(1);
    expect(env.updateEnabledRulesets).toHaveBeenCalledWith({ enableRulesetIds: [RULESET] });
    expect(env.enabled.has(RULESET)).toBe(true);
  });
});

describe("applyBlockingState idempotency (design.md pseudocode)", () => {
  it("effective state already matches intent => NO updateEnabledRulesets call", async () => {
    const env = await loadSw({ store: { blockingEnabled: true }, rulesets: [RULESET] });
    const ack = await send(env, toggleMsg(true));

    expect(ack).toEqual({ ok: true, enabled: true });
    expect(env.updateEnabledRulesets).not.toHaveBeenCalled();
    expect(env.getEnabledRulesets).toHaveBeenCalled(); // divergence check did run
    expect(env.set).toHaveBeenCalledWith({ blockingEnabled: true }); // still sole storage writer
    expect(env.enabled.has(RULESET)).toBe(true);
  });

  it("already-OFF state re-applied OFF => no update call", async () => {
    const env = await loadSw({ store: { blockingEnabled: false }, rulesets: [] });
    const ack = await send(env, toggleMsg(false));

    expect(ack).toEqual({ ok: true, enabled: false });
    expect(env.updateEnabledRulesets).not.toHaveBeenCalled();
  });
});

describe("Rapid Successive Toggling converges to last intent (popup-ui 'Fast OFF-ON-OFF')", () => {
  it("three near-simultaneous OFF-ON-OFF messages => chain serializes; final OFF applied last", async () => {
    const env = await loadSw({ store: { blockingEnabled: true }, rulesets: [RULESET] });

    // Same tick, no awaits in between — near-simultaneous.
    const pending = [
      send(env, toggleMsg(false)),
      send(env, toggleMsg(true)),
      send(env, toggleMsg(false)),
    ];
    const acks = await Promise.all(pending);

    // Each ack reports the effective state as of its own serialized link.
    expect(acks).toEqual([
      { ok: true, enabled: false },
      { ok: true, enabled: true },
      { ok: true, enabled: false },
    ]);

    // Exactly three divergent transitions, applied in order, last one OFF.
    expect(env.updateEnabledRulesets).toHaveBeenCalledTimes(3);
    expect(env.updateEnabledRulesets).toHaveBeenNthCalledWith(1, { disableRulesetIds: [RULESET] });
    expect(env.updateEnabledRulesets).toHaveBeenNthCalledWith(2, { enableRulesetIds: [RULESET] });
    expect(env.updateEnabledRulesets).toHaveBeenNthCalledWith(3, { disableRulesetIds: [RULESET] });

    // Final effective + durable intent are both OFF; no leftover intermediate state.
    expect(env.enabled.has(RULESET)).toBe(false);
    expect(env.store.blockingEnabled).toBe(false);
  });
});

describe("Effective state re-derived after update/reload — CRITICAL (extension-shell 'OFF survives update')", () => {
  // Chrome resets the ruleset to the manifest's enabled:false (= disabled) on
  // every update/reload, so a stored OFF must survive without being flipped ON.
  for (const reason of ["install", "update", "chrome_update", "shared_module_update"]) {
    it(`stored OFF survives onInstalled(reason:${reason}) — never re-enabled (manifest-reset => already-off, no enable call)`, async () => {
      const env = await loadSw({ store: { blockingEnabled: false }, rulesets: [] });
      env.listeners.onInstalled[0]({ reason });

      // The SW must read intent and reconcile DNR (ground-truth read happened)…
      await settle();
      expect(env.getEnabledRulesets).toHaveBeenCalled();
      // …and must NOT enable, now or later.
      expect(env.enableCalls()).toEqual([]);
      expect(env.store.blockingEnabled).toBe(false);
      expect(env.enabled.has(RULESET)).toBe(false);
    });
  }

  it("stored OFF with drifted-ON ruleset => onInstalled('update') actively re-disables", async () => {
    const env = await loadSw({ store: { blockingEnabled: false }, rulesets: [RULESET] });
    env.listeners.onInstalled[0]({ reason: "update" });

    await settle();
    expect(env.updateEnabledRulesets).toHaveBeenCalledTimes(1);
    expect(env.updateEnabledRulesets).toHaveBeenCalledWith({ disableRulesetIds: [RULESET] });
    expect(env.enabled.has(RULESET)).toBe(false);
    expect(env.store.blockingEnabled).toBe(false);
  });

  it("stored ON survives onInstalled('update') => blocking re-applied (extension-shell 'ON survives update')", async () => {
    const env = await loadSw({ store: { blockingEnabled: true }, rulesets: [] });
    env.listeners.onInstalled[0]({ reason: "update" });

    await settle();
    expect(env.updateEnabledRulesets).toHaveBeenCalledTimes(1);
    expect(env.updateEnabledRulesets).toHaveBeenCalledWith({ enableRulesetIds: [RULESET] });
    expect(env.enabled.has(RULESET)).toBe(true);
  });

  it("onStartup re-applies stored OFF after browser restart without enabling", async () => {
    const env = await loadSw({ store: { blockingEnabled: false }, rulesets: [] });
    env.listeners.onStartup[0]();

    await settle();
    expect(env.getEnabledRulesets).toHaveBeenCalled();
    expect(env.enableCalls()).toEqual([]);
    expect(env.enabled.has(RULESET)).toBe(false);
  });
});

describe("onMessage validation + ack (design.md message contract)", () => {
  it("valid toggle OFF => ack {ok:true, enabled:false} and ruleset disabled", async () => {
    const env = await loadSw({ store: { blockingEnabled: true }, rulesets: [RULESET] });
    const ack = await send(env, toggleMsg(false));

    expect(ack).toEqual({ ok: true, enabled: false });
    expect(ack.enabled).toBe(env.enabled.has(RULESET)); // ack == effective, vs ground truth
    expect(env.updateEnabledRulesets).toHaveBeenCalledWith({ disableRulesetIds: [RULESET] });
    expect(env.store.blockingEnabled).toBe(false);
  });

  it("async response channel: handler returns true for valid messages, false for rejected ones", async () => {
    const env = await loadSw({ store: { blockingEnabled: true }, rulesets: [RULESET] });
    let response;
    const retValid = env.listeners.onMessage[0](toggleMsg(false), { id: EXT_ID }, (r) => {
      response = r;
    });
    expect(retValid).toBe(true);
    await settle();
    expect(response).toEqual({ ok: true, enabled: false });

    let invalidResponse;
    const retInvalid = env.listeners.onMessage[0]({ type: "nope" }, { id: EXT_ID }, (r) => {
      invalidResponse = r;
    });
    expect(retInvalid).toBe(false);
    expect(invalidResponse).toEqual({ ok: false, error: "unknown message type" });
  });

  const malformed = [
    ["wrong type", { type: "setWhitelist", enabled: false }],
    ["missing enabled field", { type: "toggleBlocking" }],
    ['non-boolean enabled "true"', toggleMsg("true")],
    ["non-boolean enabled 1", toggleMsg(1)],
    ["null enabled", toggleMsg(null)],
    ["extra junk field", { type: "toggleBlocking", enabled: true, extra: "junk" }],
    ["null message", null],
    ["string message", "toggleBlocking"],
    ["array message", ["toggleBlocking", true]],
  ];

  for (const [label, payload] of malformed) {
    it(`malformed (${label}) => ack {ok:false, error} and NO storage or DNR mutation`, async () => {
      const env = await loadSw({ store: { blockingEnabled: true }, rulesets: [RULESET] });
      const ack = await send(env, payload);

      expect(ack.ok).toBe(false);
      expect(typeof ack.error).toBe("string");
      expect(ack.enabled).toBeUndefined();
      expect(env.updateEnabledRulesets).not.toHaveBeenCalled();
      expect(env.getEnabledRulesets).not.toHaveBeenCalled();
      expect(env.set).not.toHaveBeenCalled();
      expect(env.store).toEqual({ blockingEnabled: true });
      expect(env.enabled.has(RULESET)).toBe(true);
    });
  }

  it("untrusted sender (other extension id) => {ok:false, error}, no mutation", async () => {
    const env = await loadSw({ store: { blockingEnabled: true }, rulesets: [RULESET] });
    const ack = await send(env, toggleMsg(false), { id: "someone-else" });

    expect(ack.ok).toBe(false);
    expect(env.updateEnabledRulesets).not.toHaveBeenCalled();
    expect(env.enabled.has(RULESET)).toBe(true);
  });
});

describe("failure handling does not strand the apply chain", () => {
  it("DNR update rejection => ack {ok:false, error}; later intents still converge", async () => {
    let failNext = true;
    let env;
    env = await loadSw({
      store: { blockingEnabled: false },
      rulesets: [],
      updateImpl: async (change) => {
        if (failNext) {
          failNext = false;
          throw new Error("ruleset update exploded");
        }
        for (const id of change.enableRulesetIds ?? []) env.enabled.add(id);
        for (const id of change.disableRulesetIds ?? []) env.enabled.delete(id);
      },
    });

    const failedAck = await send(env, toggleMsg(true));
    expect(failedAck.ok).toBe(false);
    expect(failedAck.error).toContain("ruleset update exploded");

    // A subsequent intent must NOT be stranded by the rejected chain link.
    const okAck = await send(env, toggleMsg(true));
    expect(okAck).toEqual({ ok: true, enabled: true });
    expect(env.enabled.has(RULESET)).toBe(true);

    const offAck = await send(env, toggleMsg(false));
    expect(offAck).toEqual({ ok: true, enabled: false });
    expect(env.enabled.has(RULESET)).toBe(false);
    expect(env.store.blockingEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// New in ad-detect-block-toast: per-type router validation, session ledger,
// arbitration (D3) and popup query. Legacy matrix above stays byte-identical.
// ---------------------------------------------------------------------------

const AD_TAB = { id: 7, url: "https://myshop.com/cart", favIconUrl: "https://myshop.com/fav.ico" };
const OTHER_TAB = { id: 8, url: "https://other-site.org/home" };
const SEED_ADS = [{ condition: { urlFilter: "||doubleclick.net^" } }];

describe("Router — per-type validation (task 2.1)", () => {
  const badHosts = [
    ["empty", ""],
    ["uppercase", "Ads.Example.net"],
    ["leading dot", ".ads.example.net"],
    ["leading dash", "-ads.example.net"],
    ["space", "ads example.net"],
    ["scheme junk", "https://ads.example.net"],
    ["over 253", `${"a".repeat(250)}.net`],
  ];

  for (const [label, host] of badHosts) {
    it(`reportDetected with invalid host (${label}) => {ok:false,error}, ledger untouched`, async () => {
      const env = await loadSw({ session: {}, store: { blockingEnabled: true } });
      const ack = await send(env, { type: "reportDetected", host }, contentSender(AD_TAB));

      expect(ack).toEqual({ ok: false, error: "invalid host" });
      expect(env.sessionSet).not.toHaveBeenCalled();
      expect(env.updateDynamicRules).not.toHaveBeenCalled();
      expect(env.set).not.toHaveBeenCalled();
    });
  }

  for (const [label, host] of badHosts) {
    it(`blockHost with invalid host (${label}) => {ok:false,error}, no storage or DNR mutation`, async () => {
      const env = await loadSw({ store: { blockingEnabled: true } });
      const ack = await send(env, { type: "blockHost", host });

      expect(ack).toEqual({ ok: false, error: "invalid host" });
      expect(env.set).not.toHaveBeenCalled();
      expect(env.updateDynamicRules).not.toHaveBeenCalled();
    });
  }

  it("reportDetected without sender.tab (popup sender) => rejected", async () => {
    const env = await loadSw({ store: { blockingEnabled: true } });
    const ack = await send(env, { type: "reportDetected", host: "ads.example.net" });

    expect(ack.ok).toBe(false);
    expect(ack.prompted).toBeUndefined();
    expect(env.sessionSet).not.toHaveBeenCalled();
  });

  it("reportDetected with extra keys => unexpected message fields", async () => {
    const env = await loadSw({ store: { blockingEnabled: true } });
    const ack = await send(
      env,
      { type: "reportDetected", host: "ads.example.net", tabId: 99 },
      contentSender(AD_TAB),
    );

    expect(ack).toEqual({ ok: false, error: "unexpected message fields" });
    expect(env.sessionSet).not.toHaveBeenCalled();
  });

  it("blockHost with extra keys => unexpected message fields, no mutation", async () => {
    const env = await loadSw({ store: { blockingEnabled: true } });
    const ack = await send(env, { type: "blockHost", host: "ads.example.net", extra: 1 });

    expect(ack).toEqual({ ok: false, error: "unexpected message fields" });
    expect(env.set).not.toHaveBeenCalled();
    expect(env.updateDynamicRules).not.toHaveBeenCalled();
  });

  it("getDetectedAds requires the exact key set {type} — tabId never trusted from caller", async () => {
    const env = await loadSw({ store: { blockingEnabled: true } });
    const ack = await send(env, { type: "getDetectedAds", tabId: 7 });

    expect(ack).toEqual({ ok: false, error: "unexpected message fields" });
    expect(env.query).not.toHaveBeenCalled();
  });

  it("getDetectedAds from a content sender (has sender.tab) => rejected", async () => {
    const env = await loadSw({ store: { blockingEnabled: true } });
    const ack = await send(env, { type: "getDetectedAds" }, contentSender(AD_TAB));

    expect(ack.ok).toBe(false);
    expect(ack.entries).toBeUndefined();
    expect(env.query).not.toHaveBeenCalled();
  });

  it("new types from an untrusted sender => untrusted sender", async () => {
    const env = await loadSw({ store: { blockingEnabled: true } });
    const ackA = await send(
      env,
      { type: "reportDetected", host: "ads.example.net" },
      { id: "someone-else", tab: AD_TAB },
    );
    const ackB = await send(
      env,
      { type: "blockHost", host: "ads.example.net" },
      {
        id: "someone-else",
      },
    );

    expect(ackA).toEqual({ ok: false, error: "untrusted sender" });
    expect(ackB).toEqual({ ok: false, error: "untrusted sender" });
    expect(env.sessionSet).not.toHaveBeenCalled();
    expect(env.set).not.toHaveBeenCalled();
  });
});

describe("reportDetected — session ledger + arbitration (task 2.3, design D3)", () => {
  it("first unlisted 3P detection in a tab => {ok:true, prompted:true}; ledger entry latches prompted", async () => {
    const env = await loadSw({ store: { blockingEnabled: true }, seedRules: SEED_ADS });
    const ack = await send(
      env,
      { type: "reportDetected", host: "ads.extra-ads.net" },
      contentSender(AD_TAB),
    );

    expect(ack).toEqual({ ok: true, prompted: true });
    const ledger = env.session.detectedAds;
    expect(Object.keys(ledger["7"])).toEqual(["ads.extra-ads.net"]);
    expect(ledger["7"]["ads.extra-ads.net"].prompted).toBe(true);
    expect(typeof ledger["7"]["ads.extra-ads.net"].firstSeen).toBe("number");
  });

  it("Once per host per session: second report of the same host => prompted:false, single entry", async () => {
    const env = await loadSw({ store: { blockingEnabled: true }, seedRules: SEED_ADS });
    const first = await send(
      env,
      { type: "reportDetected", host: "ads.extra-ads.net" },
      contentSender(AD_TAB),
    );
    const second = await send(
      env,
      { type: "reportDetected", host: "ads.extra-ads.net" },
      contentSender(AD_TAB),
    );

    expect(first.prompted).toBe(true);
    expect(second).toEqual({ ok: true, prompted: false });
    expect(Object.keys(env.session.detectedAds["7"])).toEqual(["ads.extra-ads.net"]);
  });

  it("per-tab isolation: the same host on another tab prompts independently", async () => {
    const env = await loadSw({ store: { blockingEnabled: true }, seedRules: SEED_ADS });
    await send(env, { type: "reportDetected", host: "ads.extra-ads.net" }, contentSender(AD_TAB));
    const onOther = await send(
      env,
      { type: "reportDetected", host: "ads.extra-ads.net" },
      contentSender(OTHER_TAB),
    );

    expect(onOther).toEqual({ ok: true, prompted: true });
    expect(env.session.detectedAds["7"]["ads.extra-ads.net"].prompted).toBe(true);
    expect(env.session.detectedAds["8"]["ads.extra-ads.net"].prompted).toBe(true);
  });

  it("suppressed-but-detected (dismissed-elsewhere equivalent): known entry => prompted:false", async () => {
    const env = await loadSw({
      store: { blockingEnabled: true },
      session: { detectedAds: { 7: { "ads.extra-ads.net": { firstSeen: 1, prompted: true } } } },
      seedRules: SEED_ADS,
    });
    const ack = await send(
      env,
      { type: "reportDetected", host: "ads.extra-ads.net" },
      contentSender(AD_TAB),
    );

    expect(ack).toEqual({ ok: true, prompted: false });
    expect(env.session.detectedAds["7"]["ads.extra-ads.net"].firstSeen).toBe(1); // preserved
  });

  it("seed-blocked host => entry recorded but never prompted", async () => {
    const env = await loadSw({ store: { blockingEnabled: true }, seedRules: SEED_ADS });
    const ack = await send(
      env,
      { type: "reportDetected", host: "doubleclick.net" },
      contentSender(AD_TAB),
    );

    expect(ack).toEqual({ ok: true, prompted: false });
    expect(env.session.detectedAds["7"]["doubleclick.net"]).toBeDefined();
  });

  it("user-blocked host => entry recorded but never prompted", async () => {
    const env = await loadSw({
      store: { blockingEnabled: true, userBlockedHosts: { "ads.extra-ads.net": true } },
      seedRules: SEED_ADS,
    });
    const ack = await send(
      env,
      { type: "reportDetected", host: "ads.extra-ads.net" },
      contentSender(AD_TAB),
    );

    expect(ack).toEqual({ ok: true, prompted: false });
    expect(env.session.detectedAds["7"]["ads.extra-ads.net"]).toBeDefined();
  });

  it("intent OFF => detection recorded but suppressed (no prompt)", async () => {
    const env = await loadSw({ store: { blockingEnabled: false }, seedRules: SEED_ADS });
    const ack = await send(
      env,
      { type: "reportDetected", host: "ads.extra-ads.net" },
      contentSender(AD_TAB),
    );

    expect(ack).toEqual({ ok: true, prompted: false });
    expect(env.session.detectedAds["7"]["ads.extra-ads.net"]).toBeDefined();
  });

  it("first-party never offered: host sharing the tab's registrable domain => no prompt, NO entry", async () => {
    const env = await loadSw({ store: { blockingEnabled: true }, seedRules: SEED_ADS });
    const ack = await send(
      env,
      { type: "reportDetected", host: "ads.myshop.com" },
      contentSender(AD_TAB), // tab URL myshop.com => same registrable domain
    );

    expect(ack).toEqual({ ok: true, prompted: false });
    expect(env.session.detectedAds?.["7"]?.["ads.myshop.com"]).toBeUndefined();
  });

  it("ledger write failure surfaces as {ok:false,error} — no false prompt", async () => {
    const env = await loadSw({
      store: { blockingEnabled: true },
      seedRules: SEED_ADS,
      sessionSetImpl: async () => {
        throw new Error("session unavailable");
      },
    });
    const ack = await send(
      env,
      { type: "reportDetected", host: "ads.extra-ads.net" },
      contentSender(AD_TAB),
    );

    expect(ack.ok).toBe(false);
    expect(ack.error).toContain("session unavailable");
    expect(ack.prompted).toBeUndefined();
  });

  it("tabs.onRemoved prunes the closed tab's ledger slice", async () => {
    const env = await loadSw({ store: { blockingEnabled: true }, seedRules: SEED_ADS });
    await send(env, { type: "reportDetected", host: "ads.extra-ads.net" }, contentSender(AD_TAB));
    expect(env.session.detectedAds["7"]).toBeDefined();

    env.listeners.tabRemoved.forEach((fn) => fn(7, { windowId: 1 }));
    await settle();

    expect(env.session.detectedAds["7"]).toBeUndefined();
    expect(env.session.detectedAds["8"]).toBeUndefined();
  });
});

describe("getDetectedAds — popup query-on-open (tasks 2.1–2.3, design D7)", () => {
  it("lists the ACTIVE tab's entries with blocked flags = effective ON ∧ (seed ∪ user)", async () => {
    const env = await loadSw({
      store: { blockingEnabled: true, userBlockedHosts: { "ads.usertools.net": true } },
      rulesets: [RULESET],
      tabs: [AD_TAB],
      seedRules: SEED_ADS,
      session: {
        detectedAds: {
          7: {
            "doubleclick.net": { firstSeen: 100, prompted: false },
            "ads.usertools.net": { firstSeen: 200, prompted: true },
            "ads.extra-ads.net": { firstSeen: 300, prompted: true },
          },
        },
      },
    });
    const ack = await send(env, { type: "getDetectedAds" });

    expect(ack.ok).toBe(true);
    expect(ack.enabled).toBe(true);
    expect(ack.entries).toEqual([
      { host: "doubleclick.net", blocked: true }, // seed membership
      { host: "ads.usertools.net", blocked: true }, // user membership
      { host: "ads.extra-ads.net", blocked: false }, // neither
    ]);
    expect(ack.favIconUrl).toBe("https://myshop.com/fav.ico");
  });

  it("per-tab isolation: only the active tab's sources are listed (popup-ui scenario)", async () => {
    const env = await loadSw({
      store: { blockingEnabled: true },
      rulesets: [RULESET],
      tabs: [OTHER_TAB], // B active, not A
      session: {
        detectedAds: {
          7: { "tab-seven-ads.net": { firstSeen: 1, prompted: true } },
          8: { "tab-eight-ads.net": { firstSeen: 2, prompted: true } },
        },
      },
    });
    const ack = await send(env, { type: "getDetectedAds" });

    expect(ack.entries).toEqual([{ host: "tab-eight-ads.net", blocked: false }]);
  });

  it("effective OFF => enabled:false and NOTHING shown blocked (popup-ui 'Master toggle OFF respected')", async () => {
    const env = await loadSw({
      store: { blockingEnabled: false, userBlockedHosts: { "ads.usertools.net": true } },
      rulesets: [], // ruleset actually OFF (ground truth)
      tabs: [AD_TAB],
      seedRules: SEED_ADS,
      session: {
        detectedAds: {
          7: {
            "doubleclick.net": { firstSeen: 1, prompted: false },
            "ads.usertools.net": { firstSeen: 2, prompted: false },
          },
        },
      },
    });
    const ack = await send(env, { type: "getDetectedAds" });

    expect(ack.enabled).toBe(false);
    expect(ack.entries.every((e) => e.blocked === false)).toBe(true);
  });

  it("subdomain of a seed domain counts as blocked (|| anchor semantics)", async () => {
    const env = await loadSw({
      store: { blockingEnabled: true },
      rulesets: [RULESET],
      tabs: [AD_TAB],
      seedRules: [{ condition: { urlFilter: "||ads.twitter.com^" } }],
      session: {
        detectedAds: { 7: { "pixel.ads.twitter.com": { firstSeen: 1, prompted: false } } },
      },
    });
    const ack = await send(env, { type: "getDetectedAds" });

    expect(ack.entries).toEqual([{ host: "pixel.ads.twitter.com", blocked: true }]);
  });

  it("no active tab => ok with empty entries and empty favIconUrl", async () => {
    const env = await loadSw({ store: { blockingEnabled: true }, rulesets: [RULESET], tabs: [] });
    const ack = await send(env, { type: "getDetectedAds" });

    expect(ack).toEqual({ ok: true, enabled: true, entries: [], favIconUrl: "" });
  });

  it("tab without favIconUrl => empty string (glyph fallback is popup-side)", async () => {
    const env = await loadSw({
      store: { blockingEnabled: true },
      tabs: [OTHER_TAB],
      session: { detectedAds: { 8: { "a.ads-serve.net": { firstSeen: 1, prompted: true } } } },
    });
    const ack = await send(env, { type: "getDetectedAds" });

    expect(ack.favIconUrl).toBe("");
  });
});

describe("Integration-ish: report → prompt → block → rule round-trip (task 3.4)", () => {
  it("full loop on one tab incl. per-tab isolation and honest blocked flags", async () => {
    const env = await loadSw({
      store: { blockingEnabled: true },
      rulesets: [RULESET],
      tabs: [AD_TAB],
      seedRules: SEED_ADS,
    });

    // Content detects a new source plus one already-seed host on tab 7.
    const promptA = await send(
      env,
      { type: "reportDetected", host: "ads.extra-ads.net" },
      contentSender(AD_TAB),
    );
    const promptSeed = await send(
      env,
      { type: "reportDetected", host: "doubleclick.net" },
      contentSender(AD_TAB),
    );
    expect(promptA).toEqual({ ok: true, prompted: true }); // toast offered once
    expect(promptSeed.prompted).toBe(false); // already blocked => never nag

    // Tab 8 carries a different detection.
    const promptB = await send(
      env,
      { type: "reportDetected", host: "ads.other-tab.net" },
      contentSender(OTHER_TAB),
    );
    expect(promptB).toEqual({ ok: true, prompted: true });

    // Popup queries with tab 7 active: blocked only for the seed host. Entries are
    // ordered by firstSeen (chronological detection order).
    const before = await send(env, { type: "getDetectedAds" });
    expect(before.entries).toEqual([
      { host: "ads.extra-ads.net", blocked: false },
      { host: "doubleclick.net", blocked: true },
    ]);
    expect(before.favIconUrl).toBe("https://myshop.com/fav.ico");

    // User confirms through the toast route (content sender blockHost).
    const block = await send(
      env,
      { type: "blockHost", host: "ads.extra-ads.net" },
      contentSender(AD_TAB),
    );
    expect(block).toEqual({ ok: true, blocked: true });
    expect(env.dynamic).toEqual([
      {
        id: 1000,
        priority: 1,
        action: { type: "block" },
        condition: { urlFilter: "||ads.extra-ads.net^" },
      },
    ]);

    // The next popup open reflects truth: both blocked now.
    const after = await send(env, { type: "getDetectedAds" });
    expect(after.entries).toEqual([
      { host: "ads.extra-ads.net", blocked: true },
      { host: "doubleclick.net", blocked: true },
    ]);

    // Per-tab isolation: switch active tab — only B's sources are listed.
    env.query.mockImplementation(async () => [OTHER_TAB]);
    const tabB = await send(env, { type: "getDetectedAds" });
    expect(tabB.entries).toEqual([{ host: "ads.other-tab.net", blocked: false }]);

    // Closing tab 7 prunes its ledger slice entirely.
    env.listeners.tabRemoved.forEach((fn) => fn(7, { windowId: 1 }));
    await settle();
    expect(env.session.detectedAds["7"]).toBeUndefined();
    expect(env.session.detectedAds["8"]).toBeDefined();
  });

  it("dismiss sticks for the session; a new session (fresh storage.session) prompts again", async () => {
    const env = await loadSw({ store: { blockingEnabled: true }, seedRules: SEED_ADS });
    const first = await send(
      env,
      { type: "reportDetected", host: "ads.extra-ads.net" },
      contentSender(AD_TAB),
    );
    expect(first.prompted).toBe(true);

    // Dismissal happens page-side; the next detection this session must stay quiet.
    const again = await send(
      env,
      { type: "reportDetected", host: "ads.extra-ads.net" },
      contentSender(AD_TAB),
    );
    expect(again).toEqual({ ok: true, prompted: false });

    // Next session = storage.session cleared (browser-restart semantics).
    env.session.detectedAds = {};
    const nextSession = await send(
      env,
      { type: "reportDetected", host: "ads.extra-ads.net" },
      contentSender(AD_TAB),
    );
    expect(nextSession.prompted).toBe(true);
  });

  it("OFF mid-session: detections still recorded, nothing prompts, nothing shows blocked, user rules wiped (D5)", async () => {
    const env = await loadSw({
      store: { blockingEnabled: true },
      rulesets: [RULESET],
      tabs: [AD_TAB],
      seedRules: SEED_ADS,
    });
    await send(env, { type: "blockHost", host: "ads.extra-ads.net" });
    expect(env.dynamic).toHaveLength(1);

    const off = await send(env, toggleMsg(false));
    expect(off).toEqual({ ok: true, enabled: false });
    expect(env.dynamic).toEqual([]); // user rules exist only while ON

    const reported = await send(
      env,
      { type: "reportDetected", host: "ads.new-source.net" },
      contentSender(AD_TAB),
    );
    expect(reported).toEqual({ ok: true, prompted: false });

    const ack = await send(env, { type: "getDetectedAds" });
    expect(ack.enabled).toBe(false);
    expect(ack.entries.some((e) => e.blocked)).toBe(false);
    expect(ack.entries.map((e) => e.host)).toContain("ads.new-source.net");
  });
});
