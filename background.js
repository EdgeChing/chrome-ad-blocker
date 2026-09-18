// Service worker — SOLE writer of chrome.storage intent and declarativeNetRequest
// state (enabled ruleset AND user dynamic rules). The effective DNR state is always
// derived from the durable stored intent; no durable in-memory state is kept across
// calls (an MV3 service worker can be killed at any time). The only module-level
// state is `applying`, a transient promise chain used solely to serialize + collapse
// rapid writes (toggles, ledger mutations, rule reconciles); and `seedHosts`, a
// per-SW-life cache of packaged read-only data. Neither is durable: every lifecycle
// event re-derives state from storage anyway.
//
// Normative contract (design.md "Interfaces / Contracts"), NOT the illustrative
// ASCII diagrams (whose shorthand `updateEnabledRulesets({disable:[...]})` is wrong):
//   storage.local:  { "blockingEnabled": boolean }         (missing key => true)
//                   { "userBlockedHosts": {host:true} }    (missing key => {})
//   storage.session:{ "detectedAds": {tabId:{host:{firstSeen,prompted}}} }
//   popup->SW:  { type: "toggleBlocking", enabled: boolean }   => { ok, enabled }
//   content->SW:{ type: "reportDetected", host }               => { ok, prompted }
//   any->SW:    { type: "blockHost", host }                    => { ok, blocked } | { ok:false, error }
//   popup->SW:  { type: "getDetectedAds" }                     => { ok, enabled, entries, favIconUrl }
//   DNR APIs:   updateEnabledRulesets({ enableRulesetIds | disableRulesetIds })
//               updateDynamicRules({ addRules | removeRuleIds })
//
// Every message passes strict per-type validators: the sender must be this
// extension, message keys must match the type's exact contract, and `host` must
// match /^[a-z0-9][a-z0-9.-]*$/ (≤253 chars). tabId is NEVER trusted from a
// caller — the SW resolves the active tab itself.

const STORAGE_KEY = "blockingEnabled";
const USER_BLOCKED_KEY = "userBlockedHosts";
const LEDGER_KEY = "detectedAds";
const RULESET_ID = "ad_rules";
const TOGGLE_TYPE = "toggleBlocking";
const REPORT_TYPE = "reportDetected";
const BLOCK_TYPE = "blockHost";
const QUERY_TYPE = "getDetectedAds";
const HOST_RE = /^[a-z0-9][a-z0-9.-]*$/;
const HOST_MAX_LEN = 253;
// Design D6: user dynamic rules live in a debug-disjoint id space (seed rules use
// ids 1–101); next id = max(dynamic ids)+1 clamped to this floor.
const USER_RULE_ID_START = 1000;
// Conservative cap (commonly cited platform cap is 5,000; docs were unreachable at
// apply time — see design.md Open Questions). Capacity overflow => {ok:false,error}.
const MAX_USER_RULES = 1000;

// Transient serialization chain (NOT durable state). Every intent is appended so
// writes never interleave; a prior rejection is neutralized so one failed
// application can never poison later intents.
let applying = Promise.resolve();

// classify.js ships the pure registrable-domain/3P logic. In the real SW it loads as
// a classic script via importScripts and publishes AdClassify on globalThis; the
// guard keeps the vitest (ESM) load path working, where the harness pre-imports it.
if (typeof importScripts === "function") {
  importScripts("classify.js");
}

// Read the durable user intent. Missing key => default ON (proposal A2).
function readStoredIntent() {
  return chrome.storage.local.get(STORAGE_KEY).then(function (data) {
    const value = data ? data[STORAGE_KEY] : undefined;
    return typeof value === "boolean" ? value : true;
  });
}

// The sole durable user-block intent (design D4). Missing key => {}.
function readUserBlockedHosts() {
  return chrome.storage.local.get(USER_BLOCKED_KEY).then(function (data) {
    const map = data ? data[USER_BLOCKED_KEY] : undefined;
    return map && typeof map === "object" ? map : {};
  });
}

function describeError(err) {
  return err && err.message ? String(err.message) : String(err);
}

function failAck(err) {
  return { ok: false, error: describeError(err) };
}

function enqueueWork(work) {
  applying = applying.catch(() => undefined).then(work);
  return applying;
}

// --- Seed hosts (design D2/D3) ------------------------------------------------
// Packaged rules.json read once per SW life via the extension's own fetch (offline
// safe, never a network rule source). Load failure => honest empty list: nothing
// may be *shown* seed-blocked that we cannot verify.
let seedHosts = null;

function urlFilterHost(filter) {
  if (typeof filter !== "string" || !filter.startsWith("||") || !filter.endsWith("^")) {
    return "";
  }
  return filter.slice(2, -1).toLowerCase();
}

function loadSeedHosts() {
  if (seedHosts !== null) {
    return Promise.resolve(seedHosts);
  }
  return fetch(chrome.runtime.getURL("rules.json"))
    .then(function (response) {
      return response.json();
    })
    .then(function (rules) {
      seedHosts = (Array.isArray(rules) ? rules : [])
        .map(function (rule) {
          return urlFilterHost(rule && rule.condition ? rule.condition.urlFilter : "");
        })
        .filter(function (host) {
          return host !== "";
        });
      return seedHosts;
    })
    .catch(function (err) {
      console.error("Ad Blocker: seed rules load failed:", describeError(err));
      seedHosts = [];
      return seedHosts;
    });
}

// `||<host>^` anchor semantics: a seed entry covers the domain and all subdomains.
function inHostList(list, host) {
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    if (host === entry || host.endsWith("." + entry)) {
      return true;
    }
  }
  return false;
}

// --- DNR dynamic-rule reconciliation (design D5/D6) ----------------------------
// The desired dynamic set is derived from durable intent every time: user rules
// exist only while the master intent is ON. Diffing makes this idempotent —
// repeated confirms add nothing, and any platform reset self-heals on next apply.
function reconcileUserRules() {
  return Promise.all([readStoredIntent(), readUserBlockedHosts()]).then(function (parts) {
    const enabled = parts[0];
    const userMap = parts[1];
    const desired = enabled ? Object.keys(userMap) : [];
    return chrome.declarativeNetRequest.getDynamicRules().then(function (current) {
      const desiredSet = {};
      for (const host of desired) {
        desiredSet[host] = true;
      }
      const covered = {};
      const extras = [];
      let maxId = USER_RULE_ID_START - 1;
      for (const rule of current) {
        if (typeof rule.id === "number" && rule.id > maxId) {
          maxId = rule.id;
        }
        const host = urlFilterHost(rule.condition ? rule.condition.urlFilter : "");
        if (host && desiredSet[host] && !covered[host]) {
          covered[host] = rule;
        } else {
          extras.push(rule.id);
        }
      }
      const missing = desired.filter(function (host) {
        return !covered[host];
      });
      if (missing.length === 0 && extras.length === 0) {
        return undefined; // already in sync — no redundant update call (idempotent)
      }
      const nextId = Math.max(maxId + 1, USER_RULE_ID_START);
      const addRules = missing.map(function (host, i) {
        return {
          id: nextId + i,
          priority: 1,
          action: { type: "block" },
          condition: { urlFilter: "||" + host + "^" },
          // resourceTypes intentionally omitted: Chrome's default excludes
          // main_frame, so top-level navigation stays safe (ad-blocking spec).
        };
      });
      const change = {};
      if (addRules.length > 0) {
        change.addRules = addRules;
      }
      if (extras.length > 0) {
        change.removeRuleIds = extras;
      }
      return chrome.declarativeNetRequest.updateDynamicRules(change);
    });
  });
}

/**
 * The single path that writes both storage and DNR. Idempotent:
 * updateEnabledRulesets is called only when the effective state diverges from the
 * intended state (no redundant updates). Per D5 the user dynamic-rule set is
 * reconciled inside the same serialized link (OFF ⇒ removed, ON ⇒ restored).
 *
 * @param {boolean} enabled desired effective state
 * @returns {Promise<boolean>} resolves to the effective state once applied
 */
function applyBlockingState(enabled) {
  applying = applying
    .catch(() => undefined)
    .then(function () {
      return chrome.storage.local
        .set({ [STORAGE_KEY]: enabled })
        .then(function () {
          return chrome.declarativeNetRequest.getEnabledRulesets();
        })
        .then(function (ids) {
          const on = Array.isArray(ids) && ids.includes(RULESET_ID);
          if (enabled === on) {
            return enabled; // already in sync — no redundant update call
          }
          const change = enabled
            ? { enableRulesetIds: [RULESET_ID] }
            : { disableRulesetIds: [RULESET_ID] };
          return chrome.declarativeNetRequest.updateEnabledRulesets(change).then(function () {
            // Chrome guarantees the ruleset state now matches the intent we just
            // forced, so `enabled` is the authoritative effective value to report.
            return enabled;
          });
        })
        .then(function (effective) {
          return reconcileUserRules().then(function () {
            return effective;
          });
        });
    });
  return applying;
}

function reapplyStoredIntent() {
  readStoredIntent().then(applyBlockingState, function (err) {
    console.error("Ad Blocker: failed to re-apply stored intent:", describeError(err));
  });
}

// Re-derive from storage on install events. Registered for ALL reasons — the
// "update" path is the CRITICAL scenario (the platform resets enabled rulesets to
// the manifest's enabled:false on every update/reload, so a stored OFF must be
// re-applied here or it would silently flip back ON; same reset wipes dynamic
// rules, which reconcileUserRules() above restores from durable intent).
chrome.runtime.onInstalled.addListener(function () {
  reapplyStoredIntent();
});

// Re-derive from storage on browser start (covers the full-restart path).
chrome.runtime.onStartup.addListener(function () {
  reapplyStoredIntent();
});

// --- Session detection ledger (design D3) --------------------------------------
// storage.session is trusted-context-only (SW + popup), never content-reachable.
function readLedger() {
  return chrome.storage.session.get(LEDGER_KEY).then(function (data) {
    const ledger = data ? data[LEDGER_KEY] : undefined;
    return ledger && typeof ledger === "object" ? ledger : {};
  });
}

function writeLedger(ledger) {
  return chrome.storage.session.set({ [LEDGER_KEY]: ledger });
}

function handleReportDetected(host, tab) {
  return Promise.all([readStoredIntent(), loadSeedHosts(), readUserBlockedHosts()]).then(
    function (parts) {
      const intentOn = parts[0];
      const seed = parts[1];
      const userMap = parts[2];
      if (AdClassify.isFirstParty(host, tab.url)) {
        // Defense in depth: first-party is never offered AND never listed.
        return { ok: true, prompted: false };
      }
      const key = String(tab.id);
      return enqueueWork(function () {
        return readLedger().then(function (ledger) {
          const tabHosts = ledger[key] || (ledger[key] = {});
          const known = tabHosts[host];
          // Once per host per tab per session; OFF/known/already-blocked suppress.
          const prompt = !known && intentOn && !inHostList(seed, host) && userMap[host] !== true;
          tabHosts[host] = {
            firstSeen: known ? known.firstSeen : Date.now(),
            prompted: known ? known.prompted === true : prompt, // latched at prompt time
          };
          return writeLedger(ledger).then(function () {
            return { ok: true, prompted: prompt };
          });
        });
      }).catch(failAck);
    },
  );
}

function handleBlockHost(host) {
  return readUserBlockedHosts().then(function (map) {
    if (map[host] !== true && Object.keys(map).length >= MAX_USER_RULES) {
      // Spec "Quota exhausted": informed, nothing added, never a false success.
      return {
        ok: false,
        error:
          "User blocklist capacity reached (max " +
          MAX_USER_RULES +
          " hosts); nothing was blocked.",
      };
    }
    const next = Object.assign({}, map);
    next[host] = true;
    const persist =
      map[host] === true
        ? Promise.resolve()
        : chrome.storage.local.set({ [USER_BLOCKED_KEY]: next });
    return Promise.resolve(persist)
      .then(function () {
        return enqueueWork(reconcileUserRules);
      })
      .then(function () {
        return { ok: true, blocked: true };
      }, failAck);
  });
}

function handleGetDetectedAds() {
  return Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    readLedger(),
    loadSeedHosts(),
    readUserBlockedHosts(),
    chrome.declarativeNetRequest.getEnabledRulesets(),
  ]).then(function (parts) {
    const tab = (parts[0] || [])[0];
    const ledger = parts[1];
    const seed = parts[2];
    const userMap = parts[3];
    const ids = parts[4];
    // `blocked` = EFFECTIVE ON (ground-truth getEnabledRulesets) ∧ (seed ∪ user).
    // Master OFF => nothing shown blocked (popup-ui spec, approved semantics).
    const enabled = Array.isArray(ids) && ids.includes(RULESET_ID);
    const tabHosts = tab ? ledger[String(tab.id)] || {} : {};
    return {
      ok: true,
      enabled: enabled,
      entries: Object.keys(tabHosts)
        .map(function (host) {
          return {
            host: host,
            blocked: Boolean(enabled) && (inHostList(seed, host) || userMap[host] === true),
            firstSeen: tabHosts[host] ? tabHosts[host].firstSeen : 0,
          };
        })
        .sort(function (a, b) {
          return (a.firstSeen || 0) - (b.firstSeen || 0);
        })
        .map(function (entry) {
          return { host: entry.host, blocked: entry.blocked };
        }),
      favIconUrl: (tab && tab.favIconUrl) || "", // page-reported only; no remote fetch (D7)
    };
  });
}

// Closed tabs must not leak ledger slices (or let an id be reused stale).
chrome.tabs.onRemoved.addListener(function (tabId) {
  enqueueWork(function () {
    return readLedger().then(function (ledger) {
      const key = String(tabId);
      if (!Object.prototype.hasOwnProperty.call(ledger, key)) {
        return undefined;
      }
      delete ledger[key];
      return writeLedger(ledger);
    });
  }).catch(function (err) {
    console.error("Ad Blocker: failed to prune closed-tab ledger:", describeError(err));
  });
});

// --- Message router (design.md per-type contract table) ------------------------
function hasExactKeys(message, keys) {
  const own = Object.keys(message);
  return (
    own.length === keys.length &&
    keys.every(function (k) {
      return own.indexOf(k) !== -1;
    })
  );
}

function validateHostField(message) {
  const host = message.host;
  if (
    typeof host !== "string" ||
    host.length === 0 ||
    host.length > HOST_MAX_LEN ||
    !HOST_RE.test(host)
  ) {
    return "invalid host";
  }
  return null;
}

function validateToggleMessage(message, sender) {
  if (!sender || sender.id !== chrome.runtime.id) {
    return "untrusted sender";
  }
  if (!message || typeof message !== "object") {
    return "malformed message";
  }
  if (message.type !== TOGGLE_TYPE) {
    return "unknown message type";
  }
  if (typeof message.enabled !== "boolean") {
    return "enabled must be a boolean";
  }
  // Normative contract: popup->SW is EXACTLY {type, enabled}. Reject unexpected
  // extra fields so a junk-laden message can never drive a DNR mutation.
  if (!hasExactKeys(message, ["type", "enabled"])) {
    return "unexpected message fields";
  }
  return null;
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!sender || sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: "untrusted sender" });
    return false; // responded synchronously
  }
  if (!message || typeof message !== "object") {
    sendResponse({ ok: false, error: "malformed message" });
    return false;
  }

  let work;
  if (message.type === TOGGLE_TYPE) {
    const problem = validateToggleMessage(message, sender);
    if (problem) {
      sendResponse({ ok: false, error: problem });
      return false;
    }
    work = applyBlockingState(message.enabled).then(function (effective) {
      return { ok: true, enabled: effective };
    }, failAck);
  } else if (message.type === REPORT_TYPE) {
    const problem = !hasExactKeys(message, ["type", "host"])
      ? "unexpected message fields"
      : !sender.tab || typeof sender.tab.id !== "number"
        ? "sender.tab required"
        : validateHostField(message);
    if (problem) {
      sendResponse({ ok: false, error: problem });
      return false;
    }
    work = handleReportDetected(message.host, sender.tab);
  } else if (message.type === BLOCK_TYPE) {
    const problem = !hasExactKeys(message, ["type", "host"])
      ? "unexpected message fields"
      : validateHostField(message);
    if (problem) {
      sendResponse({ ok: false, error: problem });
      return false;
    }
    work = handleBlockHost(message.host);
  } else if (message.type === QUERY_TYPE) {
    const problem = !hasExactKeys(message, ["type"])
      ? "unexpected message fields"
      : sender.tab
        ? "getDetectedAds requires a popup sender"
        : null;
    if (problem) {
      sendResponse({ ok: false, error: problem });
      return false;
    }
    work = handleGetDetectedAds();
  } else {
    sendResponse({ ok: false, error: "unknown message type" });
    return false;
  }

  // Async: keep the message channel open and ack per the type's contract.
  work.then(sendResponse, function (err) {
    sendResponse(failAck(err));
  });
  return true; // signals an asynchronous sendResponse
});
