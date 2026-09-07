// Task 4.2 — service-worker logic under test with mocked chrome.*.
// Asserts against the NORMATIVE contracts in design.md "Interfaces / Contracts"
// + pseudocode — NOT the illustrative Data Flow ASCII (whose shorthand
// `updateEnabledRulesets({disable:[...]})` is wrong). Real API names:
//   updateEnabledRulesets({ enableRulesetIds | disableRulesetIds })
//   storage {"blockingEnabled":boolean}, missing => true
//   message {type:"toggleBlocking", enabled:boolean}; ack {ok:true,enabled} | {ok:false,error}
//
// background.js registers listeners at import time, so the chrome global MUST be
// stubbed BEFORE the dynamic import (vi.resetModules + await import).
import { afterEach, describe, expect, it, vi } from "vitest";

const EXT_ID = "test-extension-id";
const RULESET = "ad_rules";

/**
 * Install a fresh mock chrome environment and import a fresh background.js.
 * @param {object} options
 * @param {Record<string, unknown>} [options.store] initial storage contents ({blockingEnabled:...})
 * @param {string[]} [options.rulesets] rulesets initially enabled (models current DNR state)
 * @param {(change: object) => Promise<void>} [options.updateImpl] custom updateEnabledRulesets behavior
 */
async function loadSw({ store = {}, rulesets = [], updateImpl } = {}) {
  vi.resetModules();
  const listeners = { onInstalled: [], onStartup: [], onMessage: [] };
  const enabled = new Set(rulesets);

  const getEnabledRulesets = vi.fn(async () => [...enabled]);
  const updateEnabledRulesets = vi.fn(
    updateImpl ??
      (async (change) => {
        for (const id of change.enableRulesetIds ?? []) enabled.add(id);
        for (const id of change.disableRulesetIds ?? []) enabled.delete(id);
      }),
  );
  const get = vi.fn(async (key) =>
    Object.prototype.hasOwnProperty.call(store, key) ? { [key]: store[key] } : {},
  );
  const set = vi.fn(async (obj) => {
    Object.assign(store, obj);
  });

  vi.stubGlobal("chrome", {
    storage: { local: { get, set } },
    declarativeNetRequest: { getEnabledRulesets, updateEnabledRulesets },
    runtime: {
      id: EXT_ID,
      onInstalled: { addListener: (fn) => listeners.onInstalled.push(fn) },
      onStartup: { addListener: (fn) => listeners.onStartup.push(fn) },
      onMessage: { addListener: (fn) => listeners.onMessage.push(fn) },
    },
  });

  await import("../background.js");

  return {
    listeners,
    store,
    enabled,
    get,
    set,
    getEnabledRulesets,
    updateEnabledRulesets,
    enableCalls: () =>
      updateEnabledRulesets.mock.calls.map(([change]) => change).filter((c) => c.enableRulesetIds),
    disableCalls: () =>
      updateEnabledRulesets.mock.calls.map(([change]) => change).filter((c) => c.disableRulesetIds),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Deliver a runtime message; resolves with the sendResponse payload (sync or async). */
function send(env, message, sender = { id: EXT_ID }) {
  return new Promise((resolve) => {
    env.listeners.onMessage[0](message, sender, resolve);
  });
}

function toggleMsg(enabled) {
  return { type: "toggleBlocking", enabled: enabled };
}

/**
 * Deterministically drain the transient promise chain: every mocked Chrome call
 * resolves in microtasks, so N microtask turns settle the whole apply pipeline
 * without relying on timers or polling intervals.
 */
async function settle(turns = 100) {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

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
