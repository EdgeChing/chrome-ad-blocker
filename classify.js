// Pure detection gate — DOM-free and chrome-free (design.md D2). Delivered as a
// CLASSIC script: listed before content.js in manifest content_scripts, and pulled
// into the service worker via importScripts. It publishes `AdClassify` on globalThis,
// which is also the read path for the vitest ESM side-effect-import test idiom.
//
// Third-party test: last-2-label registrable domain, with registry-suffix exceptions
// (a true public suffix list is impossible offline, so the list stays explicit).
// Ad gate: boundary-ish tokens only — host-label containment (doubleclick,
// googlesyndication, adservice(s), adroll, taboola, outbrain, moatads, mmstat, tanx,
// cpro) or whole path-segment tokens (ad(s), banner, track(er|ing), popunder, infeed,
// optionally as a file basename like ads.js).
// Conservative contract: ANY doubt (unparseable URL, unregistrable host, non-http(s)
// scheme, first-party) => null => never report, never offer.

const AD_HOST_TOKENS = [
  "doubleclick",
  "googlesyndication",
  "adservice", // also covers googleadservices(.com) via label containment
  "adroll",
  "taboola",
  "outbrain",
  "moatads",
  "mmstat",
  "tanx",
  "cpro",
];

const AD_PATH_TOKENS = [
  "ad",
  "ads",
  "banner",
  "track",
  "tracker",
  "tracking",
  "popunder",
  "infeed",
];

// Multi-part registry suffixes: for these the registrable domain is the last 3 labels.
const REGISTRY_SUFFIXES = [
  "co.uk",
  "com.cn",
  "org.cn",
  "net.cn",
  "gov.cn",
  "co.jp",
  "or.jp",
  "ne.jp",
];

/**
 * Registrable domain of a hostname: last 2 labels, or last 3 when the final two form
 * a known registry suffix. Never throws; empty/garbage in => best-effort string out.
 */
function registrableDomain(host) {
  if (typeof host !== "string" || host === "") {
    return "";
  }
  const labels = host.toLowerCase().split(".");
  if (labels.length < 2) {
    return labels[0] || "";
  }
  const lastTwo = labels.slice(-2).join(".");
  if (REGISTRY_SUFFIXES.indexOf(lastTwo) !== -1) {
    return labels.slice(-3).join("."); // slice(-3) returns all labels when the host IS the bare suffix (e.g. "gov.cn")
  }
  return lastTwo;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * True when host and the page URL share a registrable domain — or on ANY doubt
 * (missing/unparseable values, single-label hosts). Doubt resolves to first-party so
 * the caller never reports what it cannot confidently attribute.
 */
function isFirstParty(host, pageUrl) {
  const h = typeof host === "string" ? host.toLowerCase() : "";
  const pageHost = typeof pageUrl === "string" ? hostnameOf(pageUrl) : "";
  if (h === "" || pageHost === "") {
    return true;
  }
  if (h.indexOf(".") === -1 || pageHost.indexOf(".") === -1) {
    return true; // unregistrable on either side => doubt => first-party
  }
  return registrableDomain(h) === registrableDomain(pageHost);
}

function hasHostToken(host) {
  const labels = host.split(".");
  for (let i = 0; i < labels.length; i += 1) {
    for (let t = 0; t < AD_HOST_TOKENS.length; t += 1) {
      if (labels[i].indexOf(AD_HOST_TOKENS[t]) !== -1) {
        return true;
      }
    }
  }
  return false;
}

function hasPathToken(pathname) {
  const segments = pathname.split("/");
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i].toLowerCase();
    if (seg === "") {
      continue;
    }
    for (let t = 0; t < AD_PATH_TOKENS.length; t += 1) {
      // whole-segment match, or the token as a file basename: "ads", "ads.js"
      if (seg === AD_PATH_TOKENS[t] || seg.indexOf(AD_PATH_TOKENS[t] + ".") === 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The full gate. Returns the lowercased ad host when — and only when — the load is
 * http(s), strictly third-party to pageUrl, and matches an ad-boundary token in the
 * hostname labels or the path segments. Anything else (including any parse doubt)
 * returns null: never reported, never offered.
 */
function classifyLoad(loadUrl, pageUrl) {
  let parsed;
  try {
    parsed = new URL(loadUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "" || isFirstParty(host, pageUrl)) {
    return null;
  }
  if (!hasHostToken(host) && !hasPathToken(parsed.pathname)) {
    return null;
  }
  return host;
}

// Delivery: the classic content-script world and the SW importScripts() context both
// reach these through globalThis; the ESM test loader reads the same properties.
globalThis.AdClassify = {
  registrableDomain,
  isFirstParty,
  classifyLoad,
};
