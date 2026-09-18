// Task 4.1 — validate rules.json against the NORMATIVE rule-entry contract in
// design.md "Interfaces / Contracts":
//   {"id":n,"priority":1,"action":{"type":"block"},"condition":{"urlFilter":"||<domain>^"}}
//   unique sequential ids, `resourceTypes` key omitted (Chrome default = all
//   except main_frame), seed 50–500 entries covering major CN + global networks.
// Plus the extension-shell "Declared only" audit (task 4.5): every chrome.* API
// namespace used by the shipped runtime code must be backed by a manifest
// permission — undeclared capabilities must not be used.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const raw = readFileSync(new URL("../rules.json", import.meta.url), "utf8");
const rules = JSON.parse(raw);
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

const URL_FILTER_RE = /^\|\|[a-z0-9][a-z0-9.-]*\^$/i;

function domainOf(rule) {
  return rule.condition.urlFilter.slice(2, -1);
}

describe("rules.json shape (design.md rule-entry contract)", () => {
  it("is a JSON array within the 50–500 seed bound", () => {
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThanOrEqual(50);
    expect(rules.length).toBeLessThanOrEqual(500);
  });

  it("has unique sequential ids starting at 1", () => {
    rules.forEach((rule, index) => {
      expect(rule.id).toBe(index + 1);
    });
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(rules.length);
  });

  it("every entry has exactly the contract keys and priority 1", () => {
    rules.forEach((rule) => {
      expect(Object.keys(rule).sort()).toEqual(["action", "condition", "id", "priority"]);
      expect(rule.priority).toBe(1);
      expect(Object.keys(rule.action)).toEqual(["type"]);
      expect(Object.keys(rule.condition)).toEqual(["urlFilter"]);
    });
  });

  it('every action.type is "block"', () => {
    rules.forEach((rule) => {
      expect(rule.action.type).toBe("block");
    });
  });

  it("every condition.urlFilter matches ||<domain>^", () => {
    rules.forEach((rule) => {
      expect(rule.condition.urlFilter).toMatch(URL_FILTER_RE);
    });
  });

  it("contains no resourceTypes key in any entry (and not even in the raw text)", () => {
    // Absence is deliberate: omitted resourceTypes = Chrome default set,
    // which excludes main_frame (Top-Level Navigation spec requirement).
    rules.forEach((rule) => {
      expect(JSON.stringify(rule)).not.toContain("resourceTypes");
    });
    expect(raw).not.toContain("resourceTypes");
  });

  it("has no duplicate domains", () => {
    const domains = rules.map(domainOf);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it("seeds major CN networks (Alimama, Baidu Union, Tencent) and global trackers", () => {
    const domains = new Set(rules.map(domainOf));
    // ad-blocking spec "Seed Covers Major CN and Global Ad Networks" [A1][A3]
    for (const required of [
      "alimama.com", // Alimama / 阿里妈妈
      "tanx.com", // Alimama exchange
      "cpro.baidu.com", // Baidu Union / 百度联盟
      "pos.baidu.com", // Baidu Union delivery
      "e.qq.com", // Tencent ads
      "doubleclick.net", // global
      "googlesyndication.com", // global
      "google-analytics.com", // global tracker
    ]) {
      expect(domains.has(required), `seed must include ${required}`).toBe(true);
    }
  });

  it("seed ids stay below the user-rule id floor 1000 (design D6 disjointness)", () => {
    const maxSeedId = Math.max(...rules.map((rule) => rule.id));
    expect(maxSeedId).toBeLessThan(1000);
  });
});

describe("Manifest audit — declared capabilities only (extension-shell 'Declared only', task 4.5)", () => {
  const RUNTIME_FILES = [
    "../background.js",
    "../content.js",
    "../classify.js",
    "../popup/popup.js",
  ];

  // chrome.<namespace> usage -> permission required to use it at runtime.
  const NAMESPACE_PERMISSIONS = {
    runtime: null, // always available to the extension itself
    storage: "storage",
    declarativeNetRequest: "declarativeNetRequest",
    tabs: "tabs",
  };

  function usedNamespaces() {
    const found = new Set();
    for (const file of RUNTIME_FILES) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      for (const match of source.matchAll(/\bchrome\.([A-Za-z][A-Za-z0-9]*)\./g)) {
        found.add(match[1]);
      }
    }
    return [...found].sort();
  }

  it("every used chrome.* namespace maps to a declared permission", () => {
    const declared = new Set(manifest.permissions);
    for (const ns of usedNamespaces()) {
      expect(
        Object.prototype.hasOwnProperty.call(NAMESPACE_PERMISSIONS, ns),
        `chrome.${ns} used but not covered by the audit table`,
      ).toBe(true);
      const required = NAMESPACE_PERMISSIONS[ns];
      if (required) {
        expect(declared.has(required), `chrome.${ns} requires the "${required}" permission`).toBe(
          true,
        );
      }
    }
  });

  it("content script is packaged, http/https-scoped, document_idle, gate before script", () => {
    expect(Array.isArray(manifest.content_scripts)).toBe(true);
    expect(manifest.content_scripts).toHaveLength(1);
    const [cs] = manifest.content_scripts;
    expect(cs.matches).toEqual(["http://*/*", "https://*/*"]);
    expect(cs.run_at).toBe("document_idle");
    expect(cs.js).toEqual(["classify.js", "content.js"]); // classify must load first (pure gate)
    expect(cs.css ?? [], "toast styles are inline in the closed shadow root").toEqual([]);
  });

  it("host_permissions cover the content-script matches (no undeclared page access)", () => {
    expect(manifest.host_permissions).toContain("<all_urls>");
  });

  it("still no remote code or external network rule sources (extension-shell offline)", () => {
    // Only PACKAGED code and rule data may exist (content-script `matches` URL
    // patterns are scopes, not fetched resources, so check the sources field-wise).
    expect(manifest.background.service_worker).not.toMatch(/:\/\//);
    expect(manifest.action.default_popup).not.toMatch(/:\/\//);
    for (const resource of manifest.declarative_net_request.rule_resources) {
      expect(resource.path).not.toMatch(/:\/\//);
    }
    for (const cs of manifest.content_scripts) {
      for (const file of cs.js) expect(file).not.toMatch(/:\/\//);
    }
    // Seed rule sources are packaged domain anchors only — no scheme-bearing URLs,
    // no fetch/update endpoints; rule growth happens solely via user confirmation.
    expect(rules.every((rule) => !rule.condition.urlFilter.includes("://"))).toBe(true);
    expect(manifest).not.toHaveProperty("content_security_policy.extension_pages");
  });
});
