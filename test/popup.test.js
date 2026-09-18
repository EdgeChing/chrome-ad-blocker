// Tasks 3.1–3.3 + 4.5 (glyph fallback) — popup render logic under a minimal fake DOM
// and mocked chrome.*. popup.js is a classic script that wires up on DOMContentLoaded;
// the stubs must exist BEFORE the dynamic import (same loadSw-style idiom).
// Covers popup-ui scenarios: "List on open", "Master toggle OFF respected", "Favicon
// unreachable", and honest-ack rendering (never a false blocked state).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function fakeEl(tag) {
  return {
    tagName: tag,
    children: [],
    parentNode: null,
    style: {},
    className: "",
    textContent: "",
    title: "",
    src: "",
    alt: "",
    disabled: false,
    checked: false,
    setAttribute() {},
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at !== -1) this.children.splice(at, 1);
      if (child.parentNode === this) child.parentNode = null;
      return child;
    },
    remove() {
      if (this.parentNode) {
        const at = this.parentNode.children.indexOf(this);
        if (at !== -1) this.parentNode.children.splice(at, 1);
      }
    },
    addEventListener(type, fn) {
      (this._l = this._l || {})[type] = (this._l[type] || []).concat(fn);
    },
    fire(type) {
      ((this._l || {})[type] || []).forEach((fn) => fn({ type }));
    },
  };
}

function flatten(el, acc = []) {
  acc.push(el);
  for (const child of el.children || []) flatten(child, acc);
  return acc;
}

let dom;
let swOut; // messages the popup sent
let respond; // (message) => ack | Promise<ack>

async function loadPopup({ rulesets, intent, detected } = {}) {
  vi.resetModules();
  dom = {
    elements: {
      "blocking-toggle": fakeEl("input"),
      status: fakeEl("p"),
      "detected-list": fakeEl("ul"),
      "sources-status": fakeEl("p"),
    },
    docListeners: {},
    addEventListener(type, fn) {
      (this.docListeners[type] = this.docListeners[type] || []).push(fn);
    },
    getElementById(id) {
      return this.elements[id] || null;
    },
    createElement(tag) {
      return fakeEl(tag);
    },
  };
  swOut = [];
  respond = detected;

  vi.stubGlobal("document", dom);
  vi.stubGlobal("chrome", {
    declarativeNetRequest: { getEnabledRulesets: async () => (rulesets ?? []).slice() },
    storage: {
      local: {
        get: async (key) => (intent === undefined ? {} : { [key]: intent }),
      },
    },
    runtime: {
      lastError: undefined,
      sendMessage(message, callback) {
        swOut.push(message);
        const ack = respond ? respond(message) : { ok: false, error: "no sw" };
        Promise.resolve(ack).then(callback); // async like real Chrome
      },
    },
  });

  await import("../popup/popup.js");
  dom.docListeners.DOMContentLoaded.forEach((fn) => fn());
  await settle();
}

async function settle(turns = 120) {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function listEl() {
  return dom.elements["detected-list"];
}
function sourcesStatus() {
  return dom.elements["sources-status"].textContent;
}
function rows() {
  return listEl().children;
}
function rowFor(host) {
  return rows().find((li) =>
    flatten(li).some((n) => n.className === "host" && n.textContent === host),
  );
}

describe("List on open (popup-ui 'List on open')", () => {
  beforeEach(() => {
    // no-op hook point kept explicit for clarity
  });

  it("ON with blocked + unblocked detections: domain, logo, 🚫 only if blocked, Block only if not", async () => {
    await loadPopup({
      rulesets: ["ad_rules"],
      intent: true,
      detected: (msg) =>
        msg.type === "getDetectedAds"
          ? {
              ok: true,
              enabled: true,
              favIconUrl: "https://myshop.com/fav.ico",
              entries: [
                { host: "doubleclick.net", blocked: true },
                { host: "ads.extra-ads.net", blocked: false },
              ],
            }
          : { ok: false, error: "unexpected " + msg.type },
    });

    // getDetectedAds was queried on open.
    expect(swOut.some((m) => m.type === "getDetectedAds" && Object.keys(m).join() === "type")).toBe(
      true,
    );
    expect(rows()).toHaveLength(2);

    const blocked = rowFor("doubleclick.net");
    expect(blocked).toBeDefined();
    const blockedNodes = flatten(blocked);
    expect(
      blockedNodes.some((n) => n.tagName === "img" && n.src === "https://myshop.com/fav.ico"),
    ).toBe(true);
    expect(blockedNodes.some((n) => n.textContent === "🚫")).toBe(true);
    expect(blockedNodes.some((n) => n.tagName === "button")).toBe(false);

    const open = rowFor("ads.extra-ads.net");
    const openNodes = flatten(open);
    expect(openNodes.some((n) => n.textContent === "🚫")).toBe(false);
    expect(openNodes.some((n) => n.tagName === "button" && n.textContent === "Block")).toBe(true);
  });

  it("master toggle OFF respected: NOTHING shown blocked even for seed hosts", async () => {
    await loadPopup({
      rulesets: [],
      intent: false,
      detected: (msg) =>
        msg.type === "getDetectedAds"
          ? {
              ok: true,
              enabled: false,
              favIconUrl: "https://myshop.com/fav.ico",
              entries: [{ host: "doubleclick.net", blocked: false }],
            }
          : { ok: false, error: "unexpected" },
    });

    const nodes = flatten(rowFor("doubleclick.net"));
    expect(nodes.some((n) => n.textContent === "🚫")).toBe(false);
  });

  it("empty detections => helpful empty note, no rows", async () => {
    await loadPopup({
      rulesets: ["ad_rules"],
      intent: true,
      detected: () => ({ ok: true, enabled: true, favIconUrl: "", entries: [] }),
    });
    expect(rows()).toHaveLength(0);
    expect(sourcesStatus().length).toBeGreaterThan(0);
  });

  it("detections query failure => honest unavailable note; no rows, no guessing", async () => {
    await loadPopup({
      rulesets: ["ad_rules"],
      intent: true,
      detected: () => ({ ok: false, error: "sw asleep" }),
    });
    expect(rows()).toHaveLength(0);
    expect(sourcesStatus()).toMatch(/unavailable|could not/i);
  });
});

describe("Favicon fallback (popup-ui 'Favicon unreachable' / extension-shell 'Offline retained')", () => {
  it("no favIconUrl in ack => local glyph used immediately", async () => {
    await loadPopup({
      rulesets: ["ad_rules"],
      intent: true,
      detected: () => ({
        ok: true,
        enabled: true,
        favIconUrl: "",
        entries: [{ host: "ads.example.net", blocked: false }],
      }),
    });
    const img = flatten(rowFor("ads.example.net")).find((n) => n.tagName === "img");
    expect(img.src.startsWith("data:image/svg+xml")).toBe(true);
    expect(decodeURIComponent(img.src)).toContain("A"); // deterministic letter glyph
  });

  it("favicon load error => onerror swaps to glyph exactly once, no loop", async () => {
    await loadPopup({
      rulesets: ["ad_rules"],
      intent: true,
      detected: () => ({
        ok: true,
        enabled: true,
        favIconUrl: "https://unreachable.invalid/fav.ico",
        entries: [{ host: "ads.example.net", blocked: false }],
      }),
    });
    const img = flatten(rowFor("ads.example.net")).find((n) => n.tagName === "img");
    expect(typeof img.onerror).toBe("function");
    img.onerror(); // simulate offline/unreachable
    expect(img.src.startsWith("data:image/svg+xml")).toBe(true);
    expect(img.onerror).toBeNull(); // handler cleared => no retry loop
  });

  it("glyph is deterministic per host", async () => {
    await loadPopup({
      rulesets: ["ad_rules"],
      intent: true,
      detected: () => ({
        ok: true,
        enabled: true,
        favIconUrl: "",
        entries: [
          { host: "ads.example.net", blocked: false },
          { host: "ads.example.net", blocked: false },
        ],
      }),
    });
    const imgs = rows().map((li) => flatten(li).find((n) => n.tagName === "img"));
    expect(imgs[0].src).toBe(imgs[1].src);
  });
});

describe("Block button — honest ack render (task 3.3)", () => {
  function blockResponder(state) {
    return (msg) => {
      if (msg.type === "getDetectedAds") {
        return {
          ok: true,
          enabled: true,
          favIconUrl: "",
          entries: [{ host: "ads.extra-ads.net", blocked: false }],
        };
      }
      if (msg.type === "blockHost") {
        state.blockMessages = (state.blockMessages || []).concat(msg);
        return state.blockAck;
      }
      return { ok: false, error: "unexpected " + msg.type };
    };
  }

  it("success ack => row gains 🚫, Block button gone, request is exactly {type,host}", async () => {
    const state = { blockAck: { ok: true, blocked: true } };
    await loadPopup({ rulesets: ["ad_rules"], intent: true, detected: blockResponder(state) });

    const btn = flatten(rowFor("ads.extra-ads.net")).find((n) => n.tagName === "button");
    expect(btn.disabled).toBe(false);
    btn.fire("click");
    expect(btn.disabled).toBe(true); // in-flight lock before the ack lands
    await settle();

    expect(state.blockMessages).toEqual([{ type: "blockHost", host: "ads.extra-ads.net" }]);
    const nodes = flatten(rowFor("ads.extra-ads.net"));
    expect(nodes.some((n) => n.textContent === "🚫")).toBe(true);
    expect(nodes.some((n) => n.tagName === "button")).toBe(false);
  });

  it("failure ack => error surfaces, button restored, NO 🚫 (never false blocked)", async () => {
    const state = { blockAck: { ok: false, error: "capacity reached" } };
    await loadPopup({ rulesets: ["ad_rules"], intent: true, detected: blockResponder(state) });

    const btn = flatten(rowFor("ads.extra-ads.net")).find((n) => n.tagName === "button");
    btn.fire("click");
    await settle();

    const nodes = flatten(rowFor("ads.extra-ads.net"));
    expect(nodes.some((n) => n.textContent === "🚫")).toBe(false);
    expect(btn.disabled).toBe(false);
    expect(sourcesStatus()).toMatch(/capacity reached/);
  });

  it("while OFF (lastKnown false): success stores intent but shows NO 🚫", async () => {
    await loadPopup({
      rulesets: [],
      intent: false,
      detected: (msg) => {
        if (msg.type === "getDetectedAds") {
          return {
            ok: true,
            enabled: false,
            favIconUrl: "",
            entries: [{ host: "ads.extra-ads.net", blocked: false }],
          };
        }
        if (msg.type === "blockHost") {
          return { ok: true, blocked: true };
        }
        return { ok: false, error: "unexpected" };
      },
    });

    const btn = flatten(rowFor("ads.extra-ads.net")).find((n) => n.tagName === "button");
    btn.fire("click");
    await settle();

    const nodes = flatten(rowFor("ads.extra-ads.net"));
    expect(nodes.some((n) => n.textContent === "🚫")).toBe(false);
    expect(sourcesStatus().length).toBeGreaterThan(0); // user told the truth
  });
});

describe("A5 boundary: toggle stays the sole global control (task 3.1)", () => {
  it("detection rows add NO global controls (only per-host Block buttons)", async () => {
    await loadPopup({
      rulesets: ["ad_rules"],
      intent: true,
      detected: () => ({
        ok: true,
        enabled: true,
        favIconUrl: "",
        entries: [
          { host: "ads.a.net", blocked: false },
          { host: "doubleclick.net", blocked: true },
        ],
      }),
    });
    const globalToggles = flatten(listEl()).filter(
      (n) => n.tagName === "input" || (n.tagName === "button" && !/block/i.test(n.textContent)),
    );
    expect(globalToggles).toEqual([]);
    expect(dom.elements["blocking-toggle"]).toBeDefined(); // the one and only global control
  });
});
