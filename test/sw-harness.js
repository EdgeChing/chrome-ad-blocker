// Shared service-worker test harness — the house `loadSw` idiom extracted from
// background.test.js so every SW-facing suite (router, ledger, user-rules,
// integration) drives one consistent mocked Chrome. background.js registers its
// listeners at import time, so the chrome global MUST be stubbed BEFORE the dynamic
// import; classify.js is imported first (classic script publishing AdClassify on
// globalThis) to model importScripts() in the real service worker.
import { vi } from "vitest";

export const EXT_ID = "test-extension-id";
export const RULESET = "ad_rules";

/**
 * Install a fresh mock chrome environment and import a fresh background.js.
 * @param {object} options
 * @param {Record<string, unknown>} [options.store] initial storage.local contents
 * @param {Record<string, unknown>} [options.session] initial storage.session contents
 * @param {string[]} [options.rulesets] rulesets initially enabled (effective DNR state)
 * @param {object[]} [options.dynamicRules] current dynamic DNR rules
 * @param {object[]} [options.tabs] chrome.tabs.query results (active tab first)
 * @param {object[]} [options.seedRules] rules.json payload served to the SW fetch
 * @param {(change: object) => Promise<void>} [options.updateImpl] custom updateEnabledRulesets
 * @param {(change: object) => Promise<void>} [options.dynamicUpdateImpl] custom updateDynamicRules
 * @param {(obj: object) => Promise<void>} [options.storageSetImpl] custom storage.local.set
 * @param {(obj: object) => Promise<void>} [options.sessionSetImpl] custom storage.session.set
 */
export async function loadSw({
  store = {},
  session = {},
  rulesets = [],
  dynamicRules = [],
  tabs = [],
  seedRules = [],
  updateImpl,
  dynamicUpdateImpl,
  storageSetImpl,
  sessionSetImpl,
} = {}) {
  vi.resetModules();
  await import("../classify.js");

  const listeners = { onInstalled: [], onStartup: [], onMessage: [], tabRemoved: [] };
  const enabled = new Set(rulesets);
  const dynamic = dynamicRules.slice();

  const getEnabledRulesets = vi.fn(async () => [...enabled]);
  const updateEnabledRulesets = vi.fn(
    updateImpl ??
      (async (change) => {
        for (const id of change.enableRulesetIds ?? []) enabled.add(id);
        for (const id of change.disableRulesetIds ?? []) enabled.delete(id);
      }),
  );
  const getDynamicRules = vi.fn(async () => dynamic.slice());
  const updateDynamicRules = vi.fn(
    dynamicUpdateImpl ??
      (async (change) => {
        for (const id of change.removeRuleIds ?? []) {
          const at = dynamic.findIndex((rule) => rule.id === id);
          if (at !== -1) dynamic.splice(at, 1);
        }
        for (const rule of change.addRules ?? []) dynamic.push(rule);
      }),
  );

  const get = vi.fn(async (key) =>
    Object.prototype.hasOwnProperty.call(store, key) ? { [key]: store[key] } : {},
  );
  const set = vi.fn(
    storageSetImpl ??
      (async (obj) => {
        Object.assign(store, obj);
      }),
  );
  const sessionGet = vi.fn(async (key) =>
    Object.prototype.hasOwnProperty.call(session, key) ? { [key]: session[key] } : {},
  );
  const sessionSet = vi.fn(
    sessionSetImpl ??
      (async (obj) => {
        Object.assign(session, obj);
      }),
  );

  const query = vi.fn(async () => tabs.slice());

  vi.stubGlobal("chrome", {
    storage: { local: { get, set }, session: { get: sessionGet, set: sessionSet } },
    declarativeNetRequest: {
      getEnabledRulesets,
      updateEnabledRulesets,
      getDynamicRules,
      updateDynamicRules,
    },
    tabs: {
      query,
      onRemoved: { addListener: (fn) => listeners.tabRemoved.push(fn) },
    },
    runtime: {
      id: EXT_ID,
      getURL: (path) => `chrome-extension://${EXT_ID}/${path}`,
      onInstalled: { addListener: (fn) => listeners.onInstalled.push(fn) },
      onStartup: { addListener: (fn) => listeners.onStartup.push(fn) },
      onMessage: { addListener: (fn) => listeners.onMessage.push(fn) },
    },
  });
  vi.stubGlobal("fetch", async () => ({ json: async () => seedRules.slice() }));

  await import("../background.js");

  return {
    listeners,
    store,
    session,
    enabled,
    dynamic,
    get,
    set,
    sessionGet,
    sessionSet,
    getEnabledRulesets,
    updateEnabledRulesets,
    getDynamicRules,
    updateDynamicRules,
    query,
    enableCalls: () =>
      updateEnabledRulesets.mock.calls.map(([change]) => change).filter((c) => c.enableRulesetIds),
    disableCalls: () =>
      updateEnabledRulesets.mock.calls.map(([change]) => change).filter((c) => c.disableRulesetIds),
  };
}

/** Deliver a runtime message; resolves with the sendResponse payload (sync or async). */
export function send(env, message, sender = { id: EXT_ID }) {
  return new Promise((resolve) => {
    env.listeners.onMessage[0](message, sender, resolve);
  });
}

/** A content-script sender carrying the given tab. */
export function contentSender(tab) {
  return { id: EXT_ID, tab };
}

/**
 * Deterministically drain the transient promise chain: every mocked Chrome call
 * resolves in microtasks, so N microtask turns settle the whole apply pipeline
 * without relying on timers or polling intervals.
 */
export async function settle(turns = 100) {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

export function toggleMsg(enabled) {
  return { type: "toggleBlocking", enabled: enabled };
}
