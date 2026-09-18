# Delta for ad-blocking

## ADDED Requirements

### Requirement: User-Confirmed Dynamic Blocklist

A detected unlisted ad source MUST be offered in/near page context (in-page toast primary; notification route documented as fallback, not required — locked default #1). Confirmed blocks MUST persist across browser restart and update, MUST be idempotent/deduped, and MUST NOT block top-level navigation to the host.

#### Scenario: Confirm blocks on reload

- GIVEN an unlisted third-party ad source was confirmed
- WHEN the page reloads
- THEN requests to that host are blocked; the rest loads

#### Scenario: Persist and dedupe

- GIVEN host X was confirmed once
- WHEN the browser restarts or X is confirmed again
- THEN X remains blocked and exactly one rule/entry for X exists

### Requirement: Prompt Discipline

Unlisted detections MUST be offered at most once per host per session; dismiss MUST stop asking that host that session. First-party hosts MUST NOT be offered; the detection gate MUST require third-party origin plus ad URL patterns (false-positive control). The prompt MUST state blocking applies from the next load/reload, non-retroactively (locked default #3).

#### Scenario: Once per host per session

- GIVEN the user dismissed host X this session
- WHEN X is detected again
- THEN no prompt for X appears until next session

#### Scenario: Conservative gate rejects

- GIVEN a first-party host or a third-party URL with no ad-pattern match
- WHEN detection runs
- THEN neither is offered

### Requirement: Quota and Storage Limits

If user-rule quota/ids are exhausted or durable storage fails, the extension MUST NOT report success; it MUST inform the user and MUST NOT show false blocked state.

#### Scenario: Storage failure

- GIVEN durable storage is unavailable
- WHEN the user confirms a host
- THEN the failure surfaces and nothing is shown blocked

#### Scenario: Quota exhausted

- GIVEN user-rule capacity is reached
- WHEN a new host is confirmed
- THEN no rule is added and the user is informed
