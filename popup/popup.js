// Popup — NEVER writes storage or declarativeNetRequest directly. It only READS the
// effective ruleset state for display and sends a toggle message to the service
// worker (the sole writer). On open it renders the ACTUAL effective state (ground
// truth via getEnabledRulesets), never a cached/guessed value; if that read fails it
// shows an honest "unknown" state with the control disabled.
//
// Contract mirrors background.js (see design.md "Interfaces / Contracts"):
//   storage key: "blockingEnabled"  |  message: { type:"toggleBlocking", enabled }
//   ack: { ok:true, enabled:<effective> } | { ok:false, error }

const STORAGE_KEY = "blockingEnabled";
const RULESET_ID = "ad_rules";
const TOGGLE_TYPE = "toggleBlocking";

let toggle;
let statusEl;
let lastKnown = null; // last confirmed effective boolean, or null when unknown

function describeError(err) {
  return err && err.message ? String(err.message) : String(err);
}

function isAck(response) {
  return Boolean(response) && response.ok === true && typeof response.enabled === "boolean";
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

// Render from the authoritative effective state. Re-enables the control.
function renderState(effective) {
  lastKnown = effective;
  toggle.disabled = false;
  toggle.checked = effective;
  setStatus(effective ? "Blocking is on." : "Blocking is off.", "");
}

// Honest unavailable state: disabled control + explicit message (never a guess).
function renderUnknown() {
  lastKnown = null;
  toggle.disabled = true;
  toggle.checked = false; // visually parked; the status text conveys the uncertainty
  setStatus("Status unavailable — could not read the blocking state.", "warn");
}

function readIntent() {
  return chrome.storage.local.get(STORAGE_KEY).then(function (data) {
    const value = data ? data[STORAGE_KEY] : undefined;
    return typeof value === "boolean" ? value : true;
  });
}

// Wrap the message round-trip; rejects if the SW is unreachable, resolves with the ack.
function sendToggle(enabled) {
  return new Promise(function (resolve, reject) {
    chrome.runtime.sendMessage({ type: TOGGLE_TYPE, enabled: enabled }, function (response) {
      const lastErr = chrome.runtime.lastError;
      if (lastErr) {
        reject(new Error(lastErr.message));
        return;
      }
      resolve(response);
    });
  });
}

// On open: read ground truth, render ACTUAL state, then reconcile toward durable
// intent. extension-shell makes the stored intent the source of truth, so a
// divergence (actual !== intent) is corrected by re-applying the intent through the
// SW — never by overwriting intent with the transient effective layer.
function refresh() {
  setStatus("Loading…", "");
  return chrome.declarativeNetRequest.getEnabledRulesets().then(
    function (ids) {
      const actual = Array.isArray(ids) && ids.includes(RULESET_ID);
      renderState(actual);
      return readIntent().then(
        function (intent) {
          if (actual === intent) {
            return undefined;
          }
          return sendToggle(intent).then(
            function (response) {
              if (isAck(response)) {
                renderState(response.enabled);
              }
              // Non-ack: leave the honest ACTUAL state shown; do not guess.
            },
            function () {
              // SW unreachable during re-sync: leave the honest ACTUAL state shown.
            },
          );
        },
        function () {
          // Intent unreadable, but ground-truth `actual` was already rendered.
        },
      );
    },
    function () {
      // Ground-truth read failed => unknown, never a guessed position.
      renderUnknown();
    },
  );
}

function restorePrevious(previous, message) {
  renderState(previous);
  setStatus(message, "error");
}

function onToggleChange() {
  const requested = toggle.checked;
  const previous = typeof lastKnown === "boolean" ? lastKnown : requested;
  toggle.disabled = true; // lock control while the change is in flight
  setStatus("Applying…", "");
  sendToggle(requested).then(
    function (response) {
      if (isAck(response)) {
        renderState(response.enabled); // render ACK'd effective, NEVER the requested
      } else {
        const msg =
          response && response.error
            ? String(response.error)
            : "The change could not be confirmed.";
        restorePrevious(previous, msg);
      }
    },
    function (err) {
      restorePrevious(previous, describeError(err));
    },
  );
}

document.addEventListener("DOMContentLoaded", function () {
  toggle = document.getElementById("blocking-toggle");
  statusEl = document.getElementById("status");
  toggle.addEventListener("change", onToggleChange);
  refresh();
});
