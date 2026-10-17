# Spotify in Randy

SpotOn/LMS owns authentication, Spotify requests and audio transport. Randy
owns its queue, track selection, randomizer and stickies. MPV remains the
default backend. Spotify playback requires `RANDY_PLAYER_BACKEND=lms`,
`LMS_SERVER_URL` (default `http://127.0.0.1:9000`) and `LMS_PLAYER_ID`.

## Installed interface

The implementation follows the installed SpotOn 3.5.8 plugin on LMS 9.1.1:

- `GET /plugins/SpotOn/status/data` supplies plugin version and authentication
  health. Randy returns only connection state, display name and version.
- LMS `pref plugin.spoton:accounts ?`, `pref plugin.spoton:activeAccount ?`
  and `playerpref plugin.spoton:activeAccount ?` select the display profile.
  Token stores and credential endpoints are never queried.
- `spoton items <offset> <count> menu:1 want_url:1` browses menus. Randy follows
  plugin-issued `actions.go.params.item_id` / `params.item_id`, including the
  Search input and its Tracks/Albums/Artists/Playlists categories. It never
  forwards plugin play/add actions or collection URIs to LMS playback.
- Track favorites URLs are `spoton://track:<Spotify ID>`. Album/playlist
  favorites URLs identify collections for display; navigation uses temporary
  server-side handles. Artist menu entries do not expose stable artist IDs.
- LMS playback status supplies current title, artist, album, artwork, duration,
  position and whatever source audio format/bitrate SpotOn provides.

## Settings and authentication

Connect/Reconnect opens SpotOn's own settings/authentication page in a new tab.
Randy polls status every five seconds. Account removal is a **Manage Spotify
account** link: SpotOn's settings form also saves advanced preferences, so Randy
intentionally does not reproduce or proxy that form. No credentials or OAuth
responses pass through Randy. `spotifySearchEnabled` is saved in the existing
settings database; its first authenticated default is on.

## Search and queue

Local search retains its existing endpoint. Spotify uses separate HTTP requests,
a debounce, browser cancellation/generation checks, an eight-second timeout per
LMS request, a 30-second search cache and a 30–60 second failure cooldown. Local
results never wait for Spotify. All plugin navigation is read-only.

Spotify queue entries contain `type/source: spotify`, an individual `songfile`
URI, sanitized `albumart`, and `tags.common.{title,artist,album}`. Duration is
optional because SpotOn's menu serializer can omit it. Runtime duration is
replayed after playlist redraws. Track stickies persist the same object.

Album/playlist Play replaces Randy's queue with individual tracks; Add appends
individual tracks. Randy's existing replenishment rules still apply. Collection
loads paginate, reject empty results, and stop at 2,000 entries rather than
silently enqueue a partial collection. A delayed Play request is discarded if
a newer Spotify request or Randy playback selection supersedes it. Artist browsing follows the plugin's
available album/category menus; no artist radio is added.

## Artwork and failures

`/spotify/artwork` proxies LMS's image proxy for public Spotify CDN images only.
Credentials and query strings are excluded. Missing images use Randy's record
placeholder. Cover responses belong to individual DOM images; late responses
cannot replace the image for a newly selected track. Existing playbackId guards
also reject stale LMS metadata.

Authentication expiry displays “Spotify needs to reconnect”. Unavailable plugin
tracks report one failure without advancing the queue; Play explicitly retries.
Infrastructure outages retain the LMS adapter's existing reconnect behavior.
Manual stop and replacement remain protected from false EOF events.

## Validation and current limitations

The final suite passes 184 tests. Run `node --test test/*.test.js`, syntax checks for changed JavaScript, and
`git diff --check`. Real browser tests use copied databases under `/private/tmp`,
real SpotOn/LMS/Squeezelite and a safe local WAV. They leave playback stopped and
restore the player volume. Never test persistence against the user's real DB.

The shared Spotify client currently returns HTTP 429 on search. Randy checks
SpotOn’s cumulative 429 counter after a failed search so that a transient rate
limit is named accurately even after the plugin clears its active flag, and
waits 60 seconds before retrying that failure. This blocks
complete live search/collection acceptance testing; controlled menu fixtures
exercise those UI and queue paths separately and must not be described as live
Spotify search success. Existing Radio Browser requests can also delay local
search independently of Spotify; those networking rules are unchanged.

Natural uninterrupted Spotify completion is the EOF acceptance test. Seeking
into the final second can make SpotOn stop during buffering without reporting
progress through EOF; Randy conservatively does not interpret that as completion.
The earlier external macOS SpotOn Perl compatibility patch is outside Randy and
may need reapplying after a plugin upgrade.

The real Chrome run passed 26 checks, including Settings/account status, artwork,
controls, next/previous, sticky playback, natural EOF into local playback once,
Spotify/local/radio transitions, and local search despite Spotify failure. The
listener confirmed audible Spotify playback. A second browser run passed 36
checks with controlled menu fixtures, covering all four result groups, album
queue replacement, playlist append and mobile Settings. Saved sticky playback
and artwork passed three checks after an isolated Randy restart. The native MPV
fallback passed its seven smoke checks. Full live search/collection acceptance
remains pending while Spotify rate limits persist. No commits were made.
