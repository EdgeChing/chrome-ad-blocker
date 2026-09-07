# Popup UI Specification

## Purpose

Covers the toolbar popup: a single global on/off control that reports the true effective blocking state and submits the user's intent, which becomes the durable source of truth.

## Requirements

### Requirement: Single Global Toggle [A5]

The popup MUST present exactly one user control that turns all network blocking OFF or back ON, and this control MUST be the sole false-positive escape hatch in this version (no per-site allowance is offered).

#### Scenario: User disables blocking

- GIVEN the popup is open and blocking is effectively ON
- WHEN the user flips the control to OFF and the change is accepted
- THEN the effective blocking state becomes OFF (per ad-blocking: immediate, no reload)

#### Scenario: Escape hatch for a broken page

- GIVEN a site misbehaves because a needed host is in the seed
- WHEN the user opens the popup and flips blocking OFF
- THEN the site's requests to seeded domains are allowed again until the user re-enables

### Requirement: Popup Shows Actual Effective State on Open

Every time the popup opens, its control MUST reflect the true current effective blocking state, not a cached or assumed value.

#### Scenario: Reopen after restart

- GIVEN the user set blocking OFF and the browser was restarted
- WHEN the user opens the popup
- THEN the control shows OFF and that matches the effective state

#### Scenario: Reopen after update re-derivation

- GIVEN the extension was just updated and re-applied the stored intent
- WHEN the user opens the popup
- THEN the control shows the stored intent state (e.g., OFF stays OFF)

### Requirement: User Choice Persists Across Browser Restart

When the user changes the control, that choice MUST be recorded as durable intent so the effective state after the next browser start equals the last choice.

#### Scenario: Choice restored

- GIVEN the user switched to ON, then closed and reopened the browser
- WHEN the first page with seeded ad requests loads
- THEN those requests are blocked again without further user action

### Requirement: Rapid Successive Toggling Converges to Last Intent

If the user flips the control multiple times in quick succession, the final effective state MUST match the last position shown, with no leftover intermediate state.

#### Scenario: Fast OFF-ON-OFF

- GIVEN blocking is ON and the user flips OFF, ON, OFF rapidly
- WHEN all pending state applications settle
- THEN the effective state is OFF and the control reads OFF

### Requirement: Non-Misleading When State Cannot Be Read or Applied (SHOULD)

If the popup cannot determine the true effective state, or a requested change cannot be confirmed as applied, it SHOULD indicate uncertainty or failure rather than display a confident, possibly wrong position.

#### Scenario: State read unavailable

- GIVEN the effective state cannot be read when the popup opens
- WHEN the popup renders
- THEN it shows an unknown/unavailable indication instead of a default guess

#### Scenario: Applied change unconfirmed

- GIVEN the user flips the control and applying the change fails or is unconfirmed
- WHEN the popup updates
- THEN it reflects the actual effective state or signals the failure, not the requested state
