// Task 1.2 — RED/GREEN pair for classify.js (task 1.1). FP/FN matrix per design.md
// D2: third-party test = last-2-label registrable domain with registry-suffix
// exceptions (co.uk, com.cn, org.cn, net.cn, gov.cn, co.jp, or.jp, ne.jp), ad gate =
// boundary tokens in host labels or path segments. Conservative bias: ANY doubt is
// treated as first-party and never reported. This is the gate-level cover for
// ad-blocking "Conservative gate rejects" (also verified at SW level in
// background.test.js "first-party never offered").
//
// classify.js is a classic script that publishes `AdClassify` on globalThis; the
// side-effect import below is the house load-idiom (cf. loadSw in background.test.js).
import "../classify.js";
import { describe, expect, it } from "vitest";

const AdClassify = globalThis.AdClassify;
const PAGE = "https://news.example.com/index.html";

describe("registrableDomain (design D2: last-2-label + exceptions)", () => {
  for (const [host, want] of [
    ["sub.example.com", "example.com"],
    ["example.com", "example.com"],
    ["www.news.co.uk", "news.co.uk"],
    ["shop.example.co.uk", "example.co.uk"],
    ["m.example.com.cn", "example.com.cn"],
    ["a.b.c.com.cn", "c.com.cn"],
    ["x.or.jp", "x.or.jp"],
    ["gov.cn", "gov.cn"], // registry suffix itself: cannot go deeper
    ["localhost", "localhost"],
    ["", ""],
  ]) {
    it(`${host || "(empty)"} => ${want || "(empty)"}`, () => {
      expect(AdClassify.registrableDomain(host)).toBe(want);
    });
  }
});

describe("isFirstParty — doubt => first-party (never offered)", () => {
  for (const [host, pageUrl, want] of [
    ["news.example.com", PAGE, true],
    ["cdn.news.example.com", PAGE, true],
    ["ads.example.com", PAGE, true], // 1P lookalike with ad token in host
    ["doubleclick.net", PAGE, false],
    ["example.com", "https://evil-example.com/", false], // lookalike page is still 3P
    ["ads.example.co.uk", "https://www.example.co.uk/", true], // exception suffix honored
    ["other.co.uk", "https://shop.example.co.uk/", false], // without the exception this would wrongly match
    ["sub.m.example.com.cn", "https://m.example.com.cn/", true],
    ["co.uk", "https://shop.example.co.uk/", false], // bare registry suffix !== page registrable
    ["intranet", PAGE, true], // unregistrable host => doubt
    ["doubleclick.net", "http://localhost:3000/", true], // unregistrable page => doubt
    ["", PAGE, true],
    ["doubleclick.net", "", true],
  ]) {
    it(`${host || "(empty)"} vs ${pageUrl || "(empty)"} => ${want}`, () => {
      expect(AdClassify.isFirstParty(host, pageUrl)).toBe(want);
    });
  }
});

describe("classifyLoad — reports third-party ad-token loads (hits)", () => {
  for (const [loadUrl, wantHost] of [
    // host boundary tokens
    ["https://doubleclick.net/a.js", "doubleclick.net"],
    [
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
      "pagead2.googlesyndication.com",
    ],
    ["https://adservice.google.com/adsid/integrator.js", "adservice.google.com"],
    ["https://www.googleadservices.com/pagead/conversion.js", "www.googleadservices.com"], // adservice(s)
    ["https://cdn.adroll.net/r/123", "cdn.adroll.net"],
    ["https://swap.taboola.com/x", "swap.taboola.com"],
    ["https://widgets.outbrain.com/widget", "widgets.outbrain.com"],
    ["https://z.moatads.com/x", "z.moatads.com"],
    ["https://log.mmstat.com/v.gif", "log.mmstat.com"],
    ["https://go.tanx.com/m/display", "go.tanx.com"],
    ["https://cpro.baidustatic.com/cpro/ui/cm.js", "cpro.baidustatic.com"],
    // path boundary tokens (ads?/path, banner, track(er|ing), popunder, infeed)
    ["https://cdn.statsite-a.net/banner/lead", "cdn.statsite-a.net"],
    ["https://cdn.statsite-b.net/track/pixel.gif", "cdn.statsite-b.net"],
    ["https://cdn.statsite-c.net/tracker/id", "cdn.statsite-c.net"],
    ["https://cdn.statsite-d.net/tracking/beacon", "cdn.statsite-d.net"],
    ["https://cdn.statsite-e.net/popunder/start", "cdn.statsite-e.net"],
    ["https://cdn.statsite-f.net/infeed/loader.js", "cdn.statsite-f.net"],
    ["https://cdn.statsite-g.net/ad/1x1", "cdn.statsite-g.net"],
    ["https://cdn.statsite-h.net/ads/pixel", "cdn.statsite-h.net"],
    ["https://cdn.statsite-i.net/js/ads.js", "cdn.statsite-i.net"],
    ["https://cdn.statsite-j.net/img/banner.png", "cdn.statsite-j.net"],
    // normalization
    ["https://DOUBLECLICK.NET/x", "doubleclick.net"], // case-insensitive
    ["https://doubleclick.net:8443/x?t=1", "doubleclick.net"], // port/query ignored
    ["https://notexample.com/ads/x", "notexample.com"], // lookalike domain is still third-party
  ]) {
    it(`${loadUrl} => ${wantHost}`, () => {
      expect(AdClassify.classifyLoad(loadUrl, PAGE)).toBe(wantHost);
    });
  }
});

describe("classifyLoad — Conservative gate rejects (misses, 1P, doubt)", () => {
  for (const [label, loadUrl, pageUrl] of [
    ["same-host asset", "https://news.example.com/app.js", PAGE],
    [
      "first-party subdomain carrying ad tokens (1P lookalike)",
      "https://cdn.news.example.com/doubleclick/banner.png",
      PAGE,
    ],
    ["ad token inside first-party domain", "https://doubleclick.example.com/x", PAGE],
    ["1P ads. subdomain", "https://ads.example.com/banner.png", PAGE],
    ["3P without any ad token", "https://cdn.jsdelivr.net/npm/chart.js", PAGE],
    ["3P googleapis without a host token", "https://fonts.googleapis.com/css?family=X", PAGE],
    ["3P analytics-ish without token", "https://analytics.other-cdn.com/collect", PAGE],
    ["1P within exception suffix", "https://cdn.example.co.uk/ads/x", "https://www.example.co.uk/"],
    [
      "1P deep sub within com.cn",
      "https://sub.m.example.com.cn/track.gif",
      "https://m.example.com.cn/",
    ],
    ["unregistrable page => doubt", "https://doubleclick.net/x", "http://localhost:3000/"],
    ["single-label host => doubt", "http://intranet/banner.png", PAGE],
    ["data: scheme", "data:text/plain,doubleclick.net", PAGE],
    ["blob: scheme", "blob:https://news.example.com/uuid", PAGE],
    ["extension scheme", "chrome-extension://abcdef/doubleclick.net/x", PAGE],
    ["file: scheme", "file:///C:/tmp/banner.png", PAGE],
    ["unparseable load url", "not a url", PAGE],
    ["empty load url", "", PAGE],
    ["null load url", null, PAGE],
    ["null page url", "https://doubleclick.net/x", null],
    ["empty page url", "https://doubleclick.net/x", ""],
    ["unparseable page url", "https://doubleclick.net/x", "nonsense"],
  ]) {
    it(`${label} => null`, () => {
      expect(AdClassify.classifyLoad(loadUrl, pageUrl)).toBeNull();
    });
  }
});

describe("classifyLoad — exception suffix still allows true third-party", () => {
  it("other.co.uk under a shop.example.co.uk page is reported", () => {
    expect(
      AdClassify.classifyLoad("https://other.co.uk/banner.png", "https://www.example.co.uk/"),
    ).toBe("other.co.uk");
  });
  it("other.com.cn under a m.example.com.cn page is reported", () => {
    expect(
      AdClassify.classifyLoad("https://cdn.other.com.cn/track.gif", "https://m.example.com.cn/"),
    ).toBe("cdn.other.com.cn");
  });
});
