# Delta for popup-ui

## ADDED Requirements

### Requirement: Per-Tab Detected Ad Sources List

The popup MUST list the active tab's detected ad sources — domain; logo = the tab's page-reported favicon (SHOULD) with a locally drawn glyph fallback and no extra remote fetch (MUST); and 🚫 if the host is already blocked (seed or user list). The list MUST be queried on open; live push MUST NOT be required.

#### Scenario: List on open

- GIVEN blocking is ON and the tab has blocked and unblocked detections
- WHEN the popup opens
- THEN each entry shows domain, logo, and 🚫 only if blocked

#### Scenario: Master toggle OFF respected

- GIVEN blocking is effectively OFF
- WHEN the popup opens on a tab with detections
- THEN no entry is shown as blocked

#### Scenario: Favicon unreachable

- GIVEN offline or no favicon for a host
- WHEN the list renders
- THEN a local glyph shows and the list stays functional

#### Scenario: Per-tab isolation

- GIVEN tabs A and B have different detections
- WHEN the popup opens with B active
- THEN only B's sources are listed

## MODIFIED Requirements

### Requirement: Single Global Toggle [A5]

The global toggle MUST remain the only global control and sole false-positive escape hatch. The popup MAY add the sources list and per-host block confirmations (blocklist growth only) but MUST NOT offer per-site allowlisting, nor unblock/removal — deferred (locked default #2).
(Previously: exactly one control.)

#### Scenario: Global control count unchanged

- GIVEN the sources list is shown
- WHEN the user changes blocking overall
- THEN the toggle is the only control that can
