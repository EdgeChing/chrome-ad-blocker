// Service worker — SOLE writer of chrome.storage intent and declarativeNetRequest
// enabled-ruleset state. The effective DNR state is always derived from the durable
// stored intent; no durable in-memory state is kept across calls (an MV3 service
// worker can be killed at any time). The only module-level state is `applying`, a
// transient promise chain used solely to serialize + collapse rapid toggles. It is
// not durable: every lifecycle event re-derives state from storage anyway.
//
// Normative contract (design.md "Interfaces / Contracts"), NOT the illustrative
// ASCII diagrams (whose shorthand `updateEnabledRulesets({disable:[...]})` is wrong):
//   storage:  { "blockingEnabled": boolean }            (missing key => true)
//   popup->SW: { type: "toggleBlocking", enabled: boolean }
//   SW->popup:  { ok: true,  enabled: <effective> }  |  { ok: false, error: <string> }
//   DNR API:   updateEnabledRulesets({ enableRulesetIds | disableRulesetIds })

const STORAGE_KEY = "blockingEnabled";
const RULESET_ID = "ad_rules";
const TOGGLE_TYPE = "toggleBlocking";

// Transient serialization chain (NOT durable state). Each intent is appended so the
// final effective state always equals the last intent queued. A prior rejection is
// neutralized so one failed application can never poison later intents.
let applying = Promise.resolve();

// Read the durable user intent. Missing key => default ON (proposal A2).
function readStoredIntent() {
  return chrome.storage.local.get(STORAGE_KEY).then(function (data) {
    const value = data ? data[STORAGE_KEY] : undefined;
    return typeof value === "boolean" ? value : true;
  });
}

function describeError(err) {
  return err && err.message ? String(err.message) : String(err);
}

/**
 * The single path that writes both storage and DNR. Idempotent:
 * updateEnabledRulesets is called only when the effective state diverges from the
 * intended state (no redundant updates).
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
// re-applied here or it would silently flip back ON).
chrome.runtime.onInstalled.addListener(function () {
  reapplyStoredIntent();
});

// Re-derive from storage on browser start (covers the full-restart path).
chrome.runtime.onStartup.addListener(function () {
  reapplyStoredIntent();
});

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
  const keys = Object.keys(message);
  if (keys.length !== 2 || keys.indexOf("type") === -1 || keys.indexOf("enabled") === -1) {
    return "unexpected message fields";
  }
  return null;
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  const problem = validateToggleMessage(message, sender);
  if (problem) {
    sendResponse({ ok: false, error: problem });
    return false; // responded synchronously
  }
  // Async: keep the message channel open and ack the ACK'd effective state.
  applyBlockingState(message.enabled).then(
    function (effective) {
      sendResponse({ ok: true, enabled: effective });
    },
    function (err) {
      sendResponse({ ok: false, error: describeError(err) });
    },
  );
  return true; // signals an asynchronous sendResponse
});
