// Popup — NEVER writes storage or declarativeNetRequest directly. It only READS the
// effective ruleset state for display and sends messages to the service worker (the
// sole writer). On open it renders the ACTUAL effective state (ground truth via
// getEnabledRulesets), never a cached/guessed value; if that read fails it shows an
// honest "unknown" state with the control disabled. The detected-sources list is a
// second query-on-open (getDetectedAds — no live push); its rows add per-host
// blocklist growth ONLY: the toggle stays the sole global control [A5], and there is
// deliberately no unblock/allowlist affordance (locked default #2, deferred).
//
// Contract mirrors background.js (see design.md "Interfaces / Contracts"):
//   storage key: "blockingEnabled"  |  message: { type:"toggleBlocking", enabled }
//   ack: { ok:true, enabled:<effective> } | { ok:false, error }
//   { type:"getDetectedAds" } => { ok, enabled, entries:[{host,blocked}], favIconUrl }
//   { type:"blockHost", host } => { ok, blocked:true } | { ok:false, error }

const STORAGE_KEY = "blockingEnabled";
const RULESET_ID = "ad_rules";
const TOGGLE_TYPE = "toggleBlocking";
const DETECT_TYPE = "getDetectedAds";
const BLOCK_TYPE = "blockHost";

let toggle;
let statusEl;
let listEl;
let sourcesStatusEl;
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

function setSourcesStatus(text, kind) {
  sourcesStatusEl.textContent = text;
  sourcesStatusEl.className = "status" + (kind ? " " + kind : "");
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
function sendRequest(message) {
  return new Promise(function (resolve, reject) {
    chrome.runtime.sendMessage(message, function (response) {
      const lastErr = chrome.runtime.lastError;
      if (lastErr) {
        reject(new Error(lastErr.message));
        return;
      }
      resolve(response);
    });
  });
}

function sendToggle(enabled) {
  return sendRequest({ type: TOGGLE_TYPE, enabled: enabled });
}

// --- Detected ad sources (popup-ui spec) ---------------------------------------

// Deterministic local letter-glyph SVG (data URI). Offline-safe, zero remote fetch;
// used when the tab has no favIconUrl or the image fails to load (D7).
function glyphFor(host) {
  const letter = (String(host).charAt(0) || "?").toUpperCase();
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">' +
    '<rect width="16" height="16" rx="3" fill="#64748b"></rect>' +
    '<text x="8" y="11.5" font-family="system-ui,sans-serif" font-size="10"' +
    ' font-weight="600" fill="#ffffff" text-anchor="middle">' +
    letter +
    "</text></svg>";
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

function clearList() {
  Array.prototype.slice.call(listEl.children).forEach(function (child) {
    listEl.removeChild(child);
  });
}

function appendBadge(row) {
  const badge = document.createElement("span");
  badge.className = "blocked";
  badge.title = "Blocked";
  badge.textContent = "🚫";
  row.appendChild(badge);
}

function onBlockClick(btn, row, host) {
  btn.disabled = true; // in-flight lock (house pattern from the toggle control)
  sendRequest({ type: BLOCK_TYPE, host: host }).then(
    function (response) {
      if (response && response.ok === true && response.blocked === true) {
        if (lastKnown === true) {
          btn.remove();
          appendBadge(row);
          setSourcesStatus("", "");
        } else {
          // Honest OFF semantics (D5): intent is stored, but nothing is blocked
          // while the master toggle is off — so no 🚫, ever.
          btn.disabled = false;
          setSourcesStatus("Saved. It starts blocking when ad blocking is turned on.", "");
        }
      } else {
        const msg =
          response && response.error
            ? String(response.error)
            : "The change could not be confirmed.";
        btn.disabled = false;
        setSourcesStatus(msg, "error");
      }
    },
    function (err) {
      btn.disabled = false;
      setSourcesStatus(describeError(err), "error");
    },
  );
}

function buildRow(entry, favIconUrl, enabled) {
  const row = document.createElement("li");
  row.className = "detected-row";

  const img = document.createElement("img");
  img.className = "favicon";
  img.alt = "";
  img.onerror = function () {
    img.onerror = null; // single swap — never a retry loop while offline
    img.src = glyphFor(entry.host);
  };
  img.src = favIconUrl !== "" ? favIconUrl : glyphFor(entry.host);

  const hostSpan = document.createElement("span");
  hostSpan.className = "host";
  hostSpan.textContent = entry.host;

  row.appendChild(img);
  row.appendChild(hostSpan);
  // 🚫 ONLY when the ack is effectively enabled AND the entry is blocked; OFF ⇒
  // nothing shown blocked. Everything else offers the single per-host Block.
  if (enabled === true && entry.blocked === true) {
    appendBadge(row);
  } else {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "block-btn";
    btn.textContent = "Block";
    btn.addEventListener("click", function () {
      onBlockClick(btn, row, entry.host);
    });
    row.appendChild(btn);
  }
  return row;
}

function renderSources(response) {
  clearList();
  if (!response || response.ok !== true || !Array.isArray(response.entries)) {
    setSourcesStatus("Detections unavailable — could not read this tab's ad sources.", "warn");
    return;
  }
  if (response.entries.length === 0) {
    setSourcesStatus("No ad sources detected on this tab yet.", "");
    return;
  }
  setSourcesStatus("", "");
  response.entries.forEach(function (entry) {
    listEl.appendChild(buildRow(entry, response.favIconUrl || "", response.enabled));
  });
}

// Query-on-open; live push deliberately not required (popup-ui spec).
function loadSources() {
  return sendRequest({ type: DETECT_TYPE }).then(renderSources, function () {
    renderSources(null);
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
      loadSources(); // second query on open: this tab's detected ad sources
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
  listEl = document.getElementById("detected-list");
  sourcesStatusEl = document.getElementById("sources-status");
  toggle.addEventListener("change", onToggleChange);
  refresh();
});
