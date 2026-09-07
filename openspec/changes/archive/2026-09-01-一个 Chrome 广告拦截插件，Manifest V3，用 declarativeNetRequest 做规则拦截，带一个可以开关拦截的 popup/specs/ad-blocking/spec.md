# Ad Blocking Specification

## Purpose

Covers what the network-layer rule engine must do: which requests are blocked by the seeded ruleset, which requests must never be blocked, and what coverage the seed list must provide at MVP scale.

## Requirements

### Requirement: Seeded Domains Are Blocked at Network Layer

The extension MUST block network requests whose destination matches the packaged seed ruleset whenever blocking is effectively ON.

#### Scenario: Ad asset blocked

- GIVEN blocking is ON and a page requests an image/script from a seeded ad domain
- WHEN that request goes out
- THEN the request is prevented and the rest of the page continues loading

#### Scenario: Non-matching request passes

- GIVEN blocking is ON
- WHEN a page requests a resource from a domain not in the seed
- THEN the request completes normally

### Requirement: Top-Level Navigation Never Blocked

The extension MUST NOT block a resource type corresponding to the page's own top-level document navigation; a user typing or clicking through to any URL MUST always reach that page.

#### Scenario: Direct navigation to an ad-domain URL

- GIVEN blocking is ON and `ads.example.com` is a seeded domain
- WHEN the user navigates the main frame to `ads.example.com`
- THEN the main-frame document loads (its embedded resources may still be blocked)

### Requirement: Immediate Effect Both Ways Without Page Reload

Turning blocking OFF MUST stop matching requests from being blocked immediately; turning it back ON MUST resume blocking for requests issued after that point, and neither transition requires the user to reload an already-open page.

#### Scenario: OFF stops blocking now

- GIVEN blocking is ON and an open page periodically requests a seeded ad domain
- WHEN the user toggles OFF
- THEN the page's next such request succeeds without reloading the page

#### Scenario: ON resumes blocking now

- GIVEN blocking is OFF and an open page periodically requests a seeded ad domain
- WHEN the user toggles ON
- THEN the page's next such request is blocked without reloading the page

### Requirement: Seed Covers Major CN and Global Ad Networks [A1][A3]

The seed MUST be hand-curated for MVP and MUST include the major Chinese ad networks (at minimum Alimama/阿里妈妈, Baidu Union/百度联盟, Tencent ad domains) plus well-known global ad/tracker domains; it MAY be far smaller than full community lists.

#### Scenario: Known CN network blocked

- GIVEN blocking is ON
- WHEN a Chinese news portal loads sub-resources from a Baidu Union ad endpoint in the seed
- THEN those sub-resource requests are blocked

#### Scenario: Global tracker blocked

- GIVEN blocking is ON
- WHEN any page requests a script from a globally-seeded tracker domain
- THEN the request is blocked

### Requirement: Coverage Boundaries Are Explicit

The MVP MUST be documented and behaves as top-domain coverage only: requests served by a page's own cache layer that never reach the browser's network stack MAY slip through, and full-filter-list coverage is a fast-follow, not this change.

#### Scenario: SPA self-served content acknowledged

- GIVEN a single-page app serves ad-like content from its own origin cache
- WHEN blocking is ON
- THEN content from a seeded third-party domain is still blocked while same-origin content MAY render (accepted MVP limitation)
