# Spotify ownership and personal search

Validated against LMS 9.1.1, SpotOn 3.5.8 and its 3.0.2 helper on Apple Silicon.

## Interfaces

Randy uses LMS JSON-RPC and SpotOn's `/plugins/SpotOn/status/data` endpoint.
Status supplies account authentication health, playback authorization, daemon
availability and API rate-limit information. It does not provide an authoritative
public Connect session ownership flag.

Connect playback uses `spoton://connect-*`; LMS also reports `SpotOn Connect`
versus `SpotOn Browse` in the current item's type. Both are inspected: an old
Connect URL replayed as Browse history must not be mistaken for a live session.
Individual Randy-selected Spotify tracks retain `spoton://track:<Spotify ID>`.

## Personal Client ID

Settings accepts only a 32-character hexadecimal Client ID. Randy submits it to
SpotOn's normal settings handler, preserving unrelated settings. That handler
invalidates the old API authorization and resets its caches; a raw LMS preference
write would bypass these effects. Readback verifies the setting, but the ID is
not returned to the browser or duplicated in Randy's database.

Create an app at https://developer.spotify.com/dashboard and configure exactly:
`https://stiefenm.github.io/spoton/auth/`. Save the ID in Randy, then use Reconnect
to authorize through SpotOn. Playback pairing is separate and has its own link.
Randy never requests a Client Secret, password, access token or refresh token.
No LMS restart was required in testing.

Searches for Air, Beatles and Radiohead succeeded through the personal client,
returning all four result groups without 429. This does not remove Spotify's
Development Mode restrictions or guarantee unlimited quota. A playlist-items
probe still returned 403; collection access needs separate validation.

## Ownership

The coordinator exposes `randy`, `spotify_connect`, `transitioning` and
`disconnected`. Connect takeover invalidates the current playbackId and pending
adapter retries. Its metadata is displayed separately from Randy's retained
queue. Connect stopping does not resume that queue automatically.

A Randy selection stops the adapter, pauses the SpotOn helper, clears LMS's
playlist, and waits for stopped/empty acknowledgement before loading one item.
There is no supported explicit Connect-session deactivation operation; this
releases the LMS playback path without pretending to destroy the Spotify session.
The helper control port must be reachable on the LMS host. A live paused session
can resume; a stopped/history session must be started again from Spotify.

## Silent Connect diagnosis and workaround

OGG reproduced the reported failure after local playback: Spotify appeared to
play while LMS position remained zero. SpotOn logged an OGG header timeout and
stale relay takeover. Switching devices alone did not recover that session.
No SpotOn code was patched for this issue.

The supported per-player Streaming Format setting was changed to PCM, following
SpotOn's troubleshooting guidance. The original settings were saved outside the
repository at `/private/tmp/randy-spoton-player-settings-original.json`.
With PCM, the user confirmed audible Connect return after each of local, radio
and Randy-selected Spotify playback, without reselecting the device. This is a
configuration workaround for the observed relay problem, not proof of an upstream
OGG fix or bit-perfect output. macOS audio settings were not changed.

## Validation

- 213 automated tests passed, including stale requests, ownership, settings,
  rate limiting, adapter reconnect regressions and metadata replay.
- Real Chrome: 11 checks passed, including Connect artwork/progress, queue
  separation, personal-client search and mobile setup layout.
- Live Connect pause/resume and next/previous preserved Randy's three-item queue.
- Three source handoff cycles were audibly confirmed by the user.
- Native LMS restart was not repeated in this phase; reconnect coverage is
  automated. Personal-client collection browsing remains a compatibility limit.

## Upstream references

- [SpotOn troubleshooting](https://github.com/stiefenm/spoton/blob/main/TROUBLESHOOTING.md)
- [Spotify quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [July 2026 quota changes](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates)

Development Mode requires an eligible Premium app owner and authorized users;
endpoint restrictions still apply. Current quotas are shared across an owner's
Client IDs, so creating additional IDs is not a quota workaround.
