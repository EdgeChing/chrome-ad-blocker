# Delta for extension-shell

## MODIFIED Requirements

### Requirement: Minimal Packaged Capability

Capabilities, including the detection content script, MUST be packaged at build time. The extension MUST NOT fetch blocking rules from the network; rule changes MUST arise only from user-confirmed action (user rules are user data). Offline operation MUST hold.
(Previously: packaged rule data only; no content script existed.)

#### Scenario: Offline retained

- GIVEN the machine has no network access
- WHEN the browser starts and the popup opens
- THEN state, detections (glyph fallback), and stored intent all work

#### Scenario: Confirmed rule is user data

- GIVEN no network rule source exists
- WHEN the user confirms a host
- THEN the addition is user data, not a fetched rule update

## ADDED Requirements

### Requirement: Sole Injected UI Is the Confirm Toast [A4 boundary]

The in-page prompt for new blocks MUST be the only UI injected into pages and MUST NOT hide or modify page elements; already-visible ads MAY remain (A4 preserved).

#### Scenario: No cosmetic action

- GIVEN the toast was confirmed or dismissed
- WHEN it disappears
- THEN no other page content changed at any point

### Requirement: Permissions Expansion Is Explicit

Added host and tab-read permissions MUST be declared in the packaged manifest as an explicit, reviewed capability change; undeclared capabilities MUST NOT be used.

#### Scenario: Declared only

- GIVEN detection needs page and tab metadata
- WHEN the change ships
- THEN every used permission is in the manifest
