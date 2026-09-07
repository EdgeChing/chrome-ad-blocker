# Extension Shell Specification

## Purpose

Covers the extension's lifecycle as a browser add-on: what it ships with, how the user's on/off intent is stored durably, and how the effective blocking state is kept consistent with that intent across install, browser restart, and extension update/reload. Also marks this version's scope boundary.

## Requirements

### Requirement: Minimal Packaged Capability

The extension MUST operate entirely from capabilities and rule data declared at packaging time; it MUST NOT fetch or apply blocking-rule updates from the network while running.

#### Scenario: Offline operation

- GIVEN the extension is installed on a machine with no network access
- WHEN the browser starts and the popup is opened
- THEN the extension loads, reports state, and applies the stored intent without error

### Requirement: First-Install Default Is Blocking ON [A2]

After a fresh install with no prior user choice, the extension MUST have blocking active by default, without requiring any user action.

#### Scenario: Default-on after install

- GIVEN a fresh install and no stored user choice
- WHEN a page issues a request matching a seeded blocked domain
- THEN that request is blocked before the popup has ever been opened

### Requirement: Intent Is the Durable Source of Truth

The user's on/off choice MUST be stored durably, MUST survive a full browser restart, and the effective blocking state after restart MUST equal the stored intent.

#### Scenario: OFF survives browser restart

- GIVEN the user turned blocking OFF
- WHEN the browser is fully quit and relaunched
- THEN blocking is still OFF and seeded ad requests load normally

#### Scenario: ON survives browser restart

- GIVEN the user turned blocking ON (or never changed the default)
- WHEN the browser is relaunched
- THEN seeded ad requests are blocked again without any user action

### Requirement: Effective State Re-Derived After Extension Update or Reload (CRITICAL)

Because the platform resets the enabled state of the blocking ruleset to the packaged default on every extension update or reload, the extension MUST re-apply the stored intent at those moments; a user choice of OFF MUST NOT be silently flipped back ON by an update.

#### Scenario: OFF survives update

- GIVEN the user has turned blocking OFF
- WHEN the extension is updated or reloaded
- THEN blocking remains OFF until the user explicitly turns it back ON

#### Scenario: ON survives update

- GIVEN the user has turned blocking ON
- WHEN the extension is updated
- THEN blocking is re-applied and subsequent seeded ad requests are blocked again

### Requirement: Cosmetic/DOM Layer Out of Scope [A4]

This version SHALL NOT hide or modify in-page content after load; ad content that is not fetched from a blocked domain MAY remain visible.

#### Scenario: Visible residue acknowledged

- GIVEN a page renders an in-page ad placeholder that involves no request to a seeded domain
- WHEN the page loads with blocking ON
- THEN the placeholder MAY render and no content modification is attempted
