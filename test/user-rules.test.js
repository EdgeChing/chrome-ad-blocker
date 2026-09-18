// Task 2.5 — RED/GREEN pair for the user-rule pipeline (tasks 2.2–2.4, design
// D4/D5/D6): storage.local.userBlockedHosts as sole intent (missing => {}),
// reconcile into DNR dynamic rules {id,priority:1,action:{type:"block"},
// condition:{urlFilter:"||<host>^"}} with no resourceTypes, USER_RULE_ID_START
// floor 1000 + next-id = max(dynamic ids)+1, MAX_USER_RULES capacity 1000,
// quota/storage failure => {ok:false,error} — never a false success.
import { afterEach, describe, expect, it, vi } from "vitest";
import { RULESET, contentSender, loadSw, send, settle } from "./sw-harness.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function userRule(id, host) {
  return {
    id,
    priority: 1,
    action: { type: "block" },
    condition: { urlFilter: `||${host}^` },
  };
}

function fullMap(extraHosts) {
  const map = {};
  for (let i = 0; i < 1000; i += 1) {
    map[`host-${i}.ads-fill.net`] = true;
  }
  for (const host of extraHosts ?? []) {
    map[host] = true;
  }
  return map;
}

describe("blockHost happy path (design D6 rule shape)", () => {
  it("first confirmed host => {ok:true,blocked:true}; intent map created; one DNR rule at id floor 1000", async () => {
    const env = await loadSw({ store: {}, dynamicRules: [] }); // missing key => {} => ON
    const ack = await send(env, { type: "blockHost", host: "ads.extra-ads.net" });

    expect(ack).toEqual({ ok: true, blocked: true });
    expect(env.store.userBlockedHosts).toEqual({ "ads.extra-ads.net": true });
    expect(env.dynamic).toEqual([userRule(1000, "ads.extra-ads.net")]);
  });

  it("accepted from BOTH content and popup senders (design Interfaces table)", async () => {
    const env = await loadSw({ store: { blockingEnabled: true } });
    const viaContent = await send(
      env,
      { type: "blockHost", host: "ads.from-content.net" },
      contentSender({ id: 7, url: "https://myshop.com/cart" }),
    );
    const viaPopup = await send(env, { type: "blockHost", host: "ads.from-popup.net" });

    expect(viaContent).toEqual({ ok: true, blocked: true });
    expect(viaPopup).toEqual({ ok: true, blocked: true });
    expect(env.dynamic.map((r) => r.condition.urlFilter)).toEqual([
      "||ads.from-content.net^",
      "||ads.from-popup.net^",
    ]);
  });

  it("rule carries exactly {id,priority,action.type,condition.urlFilter} — no resourceTypes (main_frame safe)", async () => {
    const env = await loadSw({ store: { blockingEnabled: true } });
    await send(env, { type: "blockHost", host: "ads.shape-check.net" });

    const [rule] = env.dynamic;
    expect(Object.keys(rule).sort()).toEqual(["action", "condition", "id", "priority"]);
    expect(Object.keys(rule.condition)).toEqual(["urlFilter"]);
    expect(JSON.stringify(rule)).not.toContain("resourceTypes");
  });
});

describe("Dedup + idempotency (ad-blocking 'Persist and dedupe')", () => {
  it("same host confirmed twice => one map key, one rule, second confirm adds NOTHING", async () => {
    const env = await loadSw({ store: { blockingEnabled: true } });
    const first = await send(env, { type: "blockHost", host: "ads.dupe.net" });
    const callsAfterFirst = env.updateDynamicRules.mock.calls.length;
    const second = await send(env, { type: "blockHost", host: "ads.dupe.net" });

    expect(first).toEqual({ ok: true, blocked: true });
    expect(second).toEqual({ ok: true, blocked: true });
    expect(Object.keys(env.store.userBlockedHosts)).toEqual(["ads.dupe.net"]);
    expect(env.dynamic).toEqual([userRule(1000, "ads.dupe.net")]);
    expect(env.updateDynamicRules.mock.calls.length).toBe(callsAfterFirst);
  });

  it("double-confirm from a tab and the popup interleaved => still exactly one rule", async () => {
    const env = await loadSw({ store: { blockingEnabled: true } });
    const acks = await Promise.all([
      send(
        env,
        { type: "blockHost", host: "ads.race.net" },
        contentSender({ id: 7, url: "https://myshop.com/" }),
      ),
      send(env, { type: "blockHost", host: "ads.race.net" }),
    ]);

    expect(acks.every((a) => a.ok === true && a.blocked === true)).toBe(true);
    expect(env.dynamic.filter((r) => r.condition.urlFilter === "||ads.race.net^")).toHaveLength(1);
  });
});

describe("Rule-id allocation (design D6)", () => {
  it("first user rule sits at the floor 1000 even when existing ids are below it", async () => {
    const env = await loadSw({
      store: { blockingEnabled: true },
      dynamicRules: [userRule(500, "legacy.leftover.net")],
    });
    await send(env, { type: "blockHost", host: "ads.new.net" });

    const added = env.dynamic.find((r) => r.condition.urlFilter === "||ads.new.net^");
    expect(added.id).toBe(1000); // max(500)+1 = 501 clamped up to the floor
    // The legacy non-user rule is an extra vs the desired set => reconciled away.
    expect(env.dynamic.map((r) => r.id)).toEqual([1000]);
  });

  it("next id = max(dynamic ids)+1 across successive confirms", async () => {
    const env = await loadSw({
      store: { blockingEnabled: true },
      dynamicRules: [userRule(1000, "ads.one.net"), userRule(1042, "ads.two.net")],
    });
    await send(env, { type: "blockHost", host: "ads.three.net" });
    await send(env, { type: "blockHost", host: "ads.four.net" });

    const byHost = Object.fromEntries(env.dynamic.map((r) => [r.condition.urlFilter, r.id]));
    expect(byHost["||ads.three.net^"]).toBe(1043);
    expect(byHost["||ads.four.net^"]).toBe(1044);
  });

  it("after OFF-removal the floor re-arms: re-enable restores rules restarting at 1000", async () => {
    const env = await loadSw({ store: { blockingEnabled: true } });
    await send(env, { type: "blockHost", host: "ads.a.net" }); // 1000
    await send(env, { type: "blockHost", host: "ads.b.net" }); // 1001
    await send(env, toggleOff()); // wipes both user rules (intent map kept)
    expect(env.dynamic).toEqual([]);

    // D5: while OFF, a (re-)confirm stores intent but adds NO rule...
    const offAck = await send(env, { type: "blockHost", host: "ads.c.net" });
    expect(offAck).toEqual({ ok: true, blocked: true });
    expect(env.dynamic).toEqual([]);

    // ...and ON reconciles everything with fresh ids restarting at the floor.
    await send(env, { type: "toggleBlocking", enabled: true });
    expect(env.dynamic.map((r) => r.id)).toEqual([1000, 1001, 1002]);
    expect(env.dynamic.map((r) => r.condition.urlFilter)).toEqual([
      "||ads.a.net^",
      "||ads.b.net^",
      "||ads.c.net^",
    ]);
  });
});

function toggleOff() {
  return { type: "toggleBlocking", enabled: false };
}

describe("Reconcile both ways + OFF semantics (design D5)", () => {
  it("adds missing and removes extras in ONE update, honoring intent", async () => {
    const env = await loadSw({
      store: {
        blockingEnabled: true,
        userBlockedHosts: { "ads.a.net": true, "ads.b.net": true },
      },
      dynamicRules: [userRule(1000, "ads.a.net"), userRule(1007, "ads.stale.net")],
    });
    // Any confirm re-runs reconcile; here the confirm itself is on a new host C.
    await send(env, { type: "blockHost", host: "ads.c.net" });

    expect(env.updateDynamicRules).toHaveBeenCalledTimes(1);
    const [change] = env.updateDynamicRules.mock.calls[0];
    expect(change.removeRuleIds).toEqual([1007]);
    expect(change.addRules.map((r) => r.condition.urlFilter).sort()).toEqual([
      "||ads.b.net^",
      "||ads.c.net^",
    ]);
    expect(change.addRules.every((r) => r.id > 1007)).toBe(true);
    expect(env.store.userBlockedHosts).toEqual({
      "ads.a.net": true,
      "ads.b.net": true,
      "ads.c.net": true,
    });
  });

  it("toggle OFF removes ALL user dynamic rules (D5: they exist only while ON)", async () => {
    const env = await loadSw({
      store: {
        blockingEnabled: true,
        userBlockedHosts: { "ads.a.net": true, "ads.b.net": true },
      },
      rulesets: [RULESET],
      dynamicRules: [userRule(1000, "ads.a.net"), userRule(1001, "ads.b.net")],
    });
    const ack = await send(env, toggleOff());

    expect(ack).toEqual({ ok: true, enabled: false });
    expect(env.enabled.has(RULESET)).toBe(false);
    expect(env.updateDynamicRules).toHaveBeenCalledWith({ removeRuleIds: [1000, 1001] });
    expect(env.dynamic).toEqual([]);
    // Intent map itself survives — the OFF is reversible by the user.
    expect(Object.keys(env.store.userBlockedHosts).sort()).toEqual(["ads.a.net", "ads.b.net"]);
  });

  it("re-enable restores user rules with fresh ids", async () => {
    const env = await loadSw({
      store: {
        blockingEnabled: false,
        userBlockedHosts: { "ads.a.net": true },
      },
      rulesets: [],
      dynamicRules: [],
    });
    await send(env, { type: "toggleBlocking", enabled: true });

    expect(env.dynamic).toEqual([userRule(1000, "ads.a.net")]);
  });

  it("survives simulated restart: onStartup re-reconciles dynamic rules lost while offline (task 4.1)", async () => {
    const env = await loadSw({
      store: { blockingEnabled: true, userBlockedHosts: { "ads.persist.net": true } },
      rulesets: [RULESET],
      dynamicRules: [], // platform reset / restart wiped the dynamic layer
    });
    env.listeners.onStartup[0]();
    await settle();

    expect(env.dynamic).toEqual([userRule(1000, "ads.persist.net")]);
    // And it stays deduped: confirming the same host again adds nothing.
    const ack = await send(env, { type: "blockHost", host: "ads.persist.net" });
    expect(ack).toEqual({ ok: true, blocked: true });
    expect(env.dynamic).toHaveLength(1);
  });
});

describe("Failure acks — never a false success (ad-blocking 'Quota and Storage Limits')", () => {
  it("durable storage failure => {ok:false,error}, no DNR change, nothing shown blocked", async () => {
    const env = await loadSw({
      store: { blockingEnabled: true },
      storageSetImpl: async () => {
        throw new Error("storage unavailable");
      },
    });
    const ack = await send(env, { type: "blockHost", host: "ads.fail.net" });

    expect(ack.ok).toBe(false);
    expect(ack.error).toContain("storage unavailable");
    expect(ack.blocked).toBeUndefined();
    expect(env.updateDynamicRules).not.toHaveBeenCalled();
    expect(env.dynamic).toEqual([]);

    // Popup truth: not blocked, not shown blocked.
    const popupAck = await send(env, { type: "getDetectedAds" });
    expect(popupAck.entries.every((e) => !e.blocked)).toBe(true);
  });

  it("DNR quota rejection surfaces as {ok:false,error}; ack never claims blocked", async () => {
    const env = await loadSw({
      store: { blockingEnabled: true },
      dynamicUpdateImpl: async () => {
        throw new Error("Rule quota exceeded");
      },
    });
    const ack = await send(env, { type: "blockHost", host: "ads.quota.net" });

    expect(ack.ok).toBe(false);
    expect(ack.error).toContain("Rule quota exceeded");
    expect(ack.blocked).toBeUndefined();
    expect(env.store.userBlockedHosts).toEqual({ "ads.quota.net": true }); // intent-first, self-heal later
  });

  it("capacity reached (MAX_USER_RULES=1000) => informed, NO rule added, map untouched", async () => {
    const env = await loadSw({
      store: { blockingEnabled: true, userBlockedHosts: fullMap([]) },
      dynamicRules: [], // ids are assigned by max(remaining)+1 => floor here
    });
    const ack = await send(env, { type: "blockHost", host: "ads.over-cap.net" });

    expect(ack.ok).toBe(false);
    expect(typeof ack.error).toBe("string");
    expect(ack.blocked).toBeUndefined();
    expect(env.updateDynamicRules).not.toHaveBeenCalled();
    expect(env.store.userBlockedHosts["ads.over-cap.net"]).toBeUndefined();
    expect(Object.keys(env.store.userBlockedHosts)).toHaveLength(1000);
  });

  it("later confirms still converge after a transient DNR failure (chain not stranded)", async () => {
    let failNext = true;
    const env = await loadSw({
      store: { blockingEnabled: true },
      dynamicUpdateImpl: async (change) => {
        if (failNext) {
          failNext = false;
          throw new Error("transient");
        }
        for (const id of change.removeRuleIds ?? []) {
          const at = env.dynamic.findIndex((r) => r.id === id);
          if (at !== -1) env.dynamic.splice(at, 1);
        }
        for (const rule of change.addRules ?? []) env.dynamic.push(rule);
      },
    });

    const bad = await send(env, { type: "blockHost", host: "ads.retry1.net" });
    expect(bad.ok).toBe(false);

    const good = await send(env, { type: "blockHost", host: "ads.retry2.net" });
    expect(good).toEqual({ ok: true, blocked: true });
    // Self-heal: the failed intent from retry1 got reconciled along the way.
    expect(env.dynamic.map((r) => r.condition.urlFilter).sort()).toEqual([
      "||ads.retry1.net^",
      "||ads.retry2.net^",
    ]);
  });
});
