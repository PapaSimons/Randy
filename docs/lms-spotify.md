# Spotify through LMS: single-track proof of concept

## Installation and authorization

On this Mac, SpotOn 3.5.8 was installed through LMS's plugin manager using
`https://raw.githubusercontent.com/stiefenm/spoton/main/repo.xml`.
Its universal macOS helper runs, but its OAuth settings require the missing
`Crypt::OpenSSL::Random` Perl module. A temporary CPAN build passed its tests;
LMS's signed Perl rejected the compiled module due to a Team ID mismatch.
No signing/security changes or custom plugin patches were made.

The permitted fallback, Spotty 4.62.3, is enabled instead; SpotOn is disabled.
LMS 9.1.1 handles all Spotify networking and credentials. Authorization has
two steps in LMS Settings > Advanced > Spotty: browser Spotify login, then
playback authorization by selecting **Spotify Authorization** in Spotify's
desktop/mobile app while the LMS authorization page remains open. A Premium
account is required. No Spotify credentials or SDK belong in Randy.

Spotty's installed settings text explicitly says Connect mode was removed.
The temporary authorization device is not a persistent Randy Connect target.
Audible Spotify playback through LMS/Squeezelite was confirmed by the user.

## JSON-RPC and identifiers

POST `/jsonrpc.js` using `slim.request`, with the configured LMS player ID
and command array in `params`. Examples:

```json
["spotty", "items", "0", "100", "menu:1"]
["spotty", "items", "0", "20", "menu:1", "item_id:1", "search:Her Majesty"]
["playlist", "play", "spotify:track:6UCFZ9ZOFRxK8oak7MdPZu"]
["status", "-", "1", "tags:uNoTIHraldK"]
```

Browse responses supply commands/parameters in `actions.go` and stable URIs
in `presetParams.favorites_url`. Follow those actions: numeric/dotted
`item_id` values are navigation handles, not persistent Spotify IDs.

| Item | Stable identity | Current availability |
| --- | --- | --- |
| Track/search result | `spotify:track:<22-character ID>` | Browse/search/play verified |
| Album | `spotify:album:<ID>` | Saved albums and direct LMS album playback verified |
| Playlist | `spotify:playlist:<ID>` | Saved playlists and direct LMS playback verified |
| Artist | `spotify:artist:<ID>` | Saved artist browsing verified |
| Made For You | Playlist URIs | Six Daily Mixes, Discover Weekly, Release Radar exposed |
| Liked Songs | Plugin's account-scoped saved-tracks query | Not exposed by the current bundled-client menu; no portable collection URI established |

Spotty gates its saved-tracks menu behind a custom LMS plugin Client ID.
That optional plugin configuration is separate from Randy; it was not changed.

## Randy ownership and metadata

An existing Randy song item can store a track URI in `songfile`, with its
normal `tags.common` fallback metadata. For example:

```json
{"songfile":"spotify:track:6UCFZ9ZOFRxK8oak7MdPZu","type":"spotify","albumart":"","tags":{"common":{"title":"Her Majesty","artist":"The Beatles","album":"Abbey Road"}}}
```

The LMS adapter accepts only individual Spotify track URIs, not album,
playlist, artist, episode or arbitrary plugin schemes. LMS canonicalizes
`spotify:track:...` into `spotify://track:...`; identity checks accept either.
Each selection replaces LMS's queue with one track, shuffle/repeat off.
Randy continues selecting next/previous and processing completion.
The proof of concept does not add Spotify browsing or URL entry to Randy's UI;
real-server tests use copied, isolated databases containing these song items.

LMS supplies title, artist, album, artwork, duration and position. The server
uses existing `nowplaying`, `duration`, `pos` and `audiostats` events. Relative
artwork paths resolve against `LMS_SERVER_URL`, which must be browser-reachable.
Observed audio stats: `OGG 44.1kHz 16bit 320kbps`. These are plugin-reported
values: Spotty supplies configured bitrate and may default sample size/rate;
they do not measure instantaneous bitrate, lossless resolution or DAC output.

Spotify tracks reuse finite-track seek, pause, stop, recovery and EOF behavior.
The first stopped status may omit duration; completion uses the previous
current-track duration while retaining playback ID/manual-stop protections.
MPV and HTTP radio retain their existing paths. A future album/playlist browser
must expand items into Randy's queue rather than passing a collection to LMS.

## Validation on this Mac

`node --test test/player-*.test.js` passes 118 tests, including URI validation,
canonical identity, metadata clearing/replay, stale replies, controls, EOF with
missing duration, manual stop and reconnect recovery. Syntax and diff checks pass.
Direct LMS testing covers search/browse, track/album/playlist playback and
controls. The real adapter switches Spotify → Spotify → local WAV → MP3 radio
→ Spotify and emits one completion event. Natural completion was also tested
without seeking using the approximately 26-second “Her Majesty” track.

An actual Randy server on port 3119, using copied databases under `/private/tmp`,
passes real Socket.IO play/pause/resume/seek/volume, next/previous, explicit
selection, EOF advancement, local/radio switching and LMS restart recovery.
Position updates remain frequent enough for the existing UI contract. The
four-item Randy queue remains intact while LMS contains one current track,
with shuffle/repeat disabled. Graceful Randy shutdown leaves LMS stopped.
Validation uses HTTP/Socket.IO directly; browser rendering was not automated.
The separate real-server MPV fallback smoke test also passes playback,
pause/resume, seek, volume and single EOF advancement. Tests leave LMS/Squeezelite
running, playback stopped, and the pre-test player volume restored.
