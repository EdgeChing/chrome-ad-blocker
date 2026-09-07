// Task 4.1 — validate rules.json against the NORMATIVE rule-entry contract in
// design.md "Interfaces / Contracts":
//   {"id":n,"priority":1,"action":{"type":"block"},"condition":{"urlFilter":"||<domain>^"}}
//   unique sequential ids, `resourceTypes` key omitted (Chrome default = all
//   except main_frame), seed 50–500 entries covering major CN + global networks.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const raw = readFileSync(new URL("../rules.json", import.meta.url), "utf8");
const rules = JSON.parse(raw);

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
});
