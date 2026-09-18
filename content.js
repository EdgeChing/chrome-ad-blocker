// Content script — packaged, http/https only, document_idle (manifest.json).
// The in-page confirm toast is the ONLY UI this extension injects (extension-shell
// [A4]): it never hides or modifies page elements; already-visible ads MAY remain.
// Detection source per design D1: buffered resource timing — this sees ads that
// loaded UNBLOCKED (declarativeNetRequest.getMatchedRules is blind to those).
// The decision is delegated to classify.js (AdClassify), loaded as a classic script
// ahead of this one in the same isolated world; whether to PROMPT is delegated to
// the service worker (design D3 — ledger, once/host/tab/session, OFF ⇒ suppress).

const REPORT_TYPE = "reportDetected";
const BLOCK_TYPE = "blockHost";
const TOAST_AUTO_DISMISS_MS = 8000;

// Local message-spam guard only; the SW ledger is the authority on prompting once
// per host per session (this Set dies with the document anyway).
const reportedHosts = new Set();
// Toasts render one at a time (design D8 queue).
const toastQueue = [];
let toastShowing = false;

function describeLastLabelError() {
  return chrome.runtime.lastError && chrome.runtime.lastError.message
    ? String(chrome.runtime.lastError.message)
    : "";
}

function report(host) {
  try {
    chrome.runtime.sendMessage({ type: REPORT_TYPE, host: host }, function (response) {
      if (describeLastLabelError()) {
        return; // SW asleep-unreachable or invalidated context: silently drop
      }
      if (response && response.ok === true && response.prompted === true) {
        queueToast(host); // SW said yes — the ONLY way a toast appears
      }
    });
  } catch {
    // Extension was reloaded/orphaned; this document's channel is dead.
  }
}

function examine(entries) {
  for (let i = 0; i < entries.length; i += 1) {
    const host = AdClassify.classifyLoad(entries[i].name, location.href);
    if (!host || reportedHosts.has(host)) {
      continue;
    }
    reportedHosts.add(host);
    report(host);
  }
}

function handleRecords(list) {
  examine(list.getEntries());
}

function startObserving() {
  try {
    const observer = new PerformanceObserver(handleRecords);
    observer.observe({ type: "resource", buffered: true });
  } catch {
    // No observer available — fall back to the one-shot snapshot below only.
  }
  // Seed pass: entries that completed before this document_idle script attached
  // (belt-and-suspenders; buffered:true normally replays them to the observer).
  try {
    examine(performance.getEntriesByType("resource"));
  } catch {
    // performance unavailable — nothing to report.
  }
}

function buildToast(host) {
  const anchor = document.createElement("div");
  const shadow = anchor.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  // All styling is inline in the closed shadow root — zero page CSS bleed either
  // way (design D8).
  style.textContent = [
    ".toast{position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:320px;",
    "display:flex;gap:8px;align-items:flex-start;padding:10px 12px;border-radius:8px;",
    "background:#1f2937;color:#f9fafb;font:13px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;",
    "box-shadow:0 4px 14px rgba(0,0,0,.35)}",
    ".msg{margin:0;flex:1 1 auto;word-break:break-word}",
    ".actions{display:flex;gap:6px;flex:none;align-items:center}",
    "button{font:inherit;cursor:pointer;border-radius:5px;border:1px solid #4b5563;",
    "background:#2563eb;color:#fff;padding:3px 10px}",
    "button:disabled{opacity:.6;cursor:default}",
    "button.x{background:transparent;border:none;color:#9ca3af;font-size:16px;padding:0 2px;line-height:1}",
  ].join("");

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");

  const message = document.createElement("p");
  message.className = "msg";
  // Locked default #3: the copy MUST state non-retroactivity (host is the safe
  // [a-z0-9.-] charset by contract, and we still use textContent).
  message.textContent =
    "Ad Blocker noticed an ad source: " +
    host +
    ". Blocking starts at the next reload — it won't remove this one.";

  const actions = document.createElement("span");
  actions.className = "actions";

  const blockBtn = document.createElement("button");
  blockBtn.textContent = "Block";

  const dismissBtn = document.createElement("button");
  dismissBtn.className = "x";
  dismissBtn.textContent = "\u00d7"; // ×: dismiss = remove only; `prompted` was
  // already latched by the SW at prompt time, so this host stays quiet all session.
  dismissBtn.setAttribute("aria-label", "Dismiss");

  actions.appendChild(blockBtn);
  actions.appendChild(dismissBtn);
  toast.appendChild(message);
  toast.appendChild(actions);
  shadow.appendChild(style);
  shadow.appendChild(toast);

  return {
    anchor: anchor,
    message: message,
    actions: actions,
    blockBtn: blockBtn,
    dismissBtn: dismissBtn,
  };
}

function queueToast(host) {
  toastQueue.push(host);
  if (!toastShowing) {
    showNextToast();
  }
}

function showNextToast() {
  if (toastQueue.length === 0) {
    toastShowing = false;
    return;
  }
  toastShowing = true;
  const host = toastQueue.shift();
  const ui = buildToast(host);
  let closed = false;

  function close() {
    if (closed) {
      return;
    }
    closed = true;
    window.clearTimeout(timer);
    ui.anchor.remove(); // A4: leave no trace — page content is unchanged
    showNextToast();
  }

  const timer = window.setTimeout(close, TOAST_AUTO_DISMISS_MS);

  ui.dismissBtn.addEventListener("click", close);
  ui.blockBtn.addEventListener("click", function () {
    ui.blockBtn.disabled = true;
    ui.dismissBtn.disabled = true;
    try {
      chrome.runtime.sendMessage({ type: BLOCK_TYPE, host: host }, function (response) {
        const transportError = describeLastLabelError();
        if (!transportError && response && response.ok === true && response.blocked === true) {
          // Confirm-ack swap: honest success message replaces the prompt controls.
          ui.actions.remove();
          ui.message.textContent = "OK — " + host + " will be blocked starting at the next reload.";
        } else {
          const why =
            transportError || (response && response.error) || "the request could not be confirmed";
          ui.message.textContent = "Couldn't block " + host + ": " + why;
          ui.blockBtn.disabled = false;
          ui.dismissBtn.disabled = false;
        }
      });
    } catch (err) {
      ui.message.textContent = "Couldn't block " + host + ": " + String(err);
      ui.blockBtn.disabled = false;
      ui.dismissBtn.disabled = false;
    }
  });

  document.documentElement.appendChild(ui.anchor);
}

startObserving();
