# Focused Spotify and audio-output UX cleanup

## Settings and item presentation

Audio Output and Spotify reuse the white, rounded Music Folders `.device` card.
Spotify shows only account/playback connection status, the search checkbox and a
link to the actual SpotOn settings in a new tab. Authentication, Client ID setup
and diagnostics stay in SpotOn; Randy has no embedded configuration panel.

Local and Spotify search tracks share `randyUI.row`, 44px artwork, typography,
spacing and accessible Play/Add/Sticky SVG buttons. Existing local actions and
Spotify queue operations are preserved. Local search uses existing metadata
cache/folder artwork without new online metadata lookups. Missing artwork uses
the same Record placeholder. Local albums use the same row presentation too.

General Spotify search displays tracks, albums and artists. Playlist browsing
and expansion remain available in the backend; playlists are only omitted from
general search presentation. The detached LOCAL heading is removed.

Queue file/Spotify rows share artwork, details, duration and current-row styling.
Small source icons remain intact when now-playing metadata updates. Radio keeps
its existing presentation. Shared icons are inline SVG paths in `item-ui.js`,
with accessible button names and no icon-font dependency. Open in Spotify is a
compact external-link icon.

The persistent Connect notice is a single status element in the playlist pane:
`Spotify Connect · Track — Artist`. It stays through pause, changes with track
metadata, clears old text on a new track identity, and disappears on stop,
disconnect or Randy takeover. Repeated identical polls do not rewrite its live
region text. The Connect track row has normal cover/details/duration columns;
the notice replaces its redundant source label.

## Artwork

Public SpotOn artwork still flows through Randy's existing LMS imageproxy.
Search and queue requests use `size=300`; now-playing uses `size=640`, so a new
browser cache key also avoids previously cached small images. The backend accepts
only these two sizes. Source URLs are not rewritten to guess other Spotify image
IDs, and credentials are never exposed. Actual now-playing image width >=500px
was verified in Chrome (640px proxy target). Original source limitations still
apply; resizing cannot create detail absent from the source.

## Audio output

The LMS Settings selector uses `squeezelite -l`. macOS devices use Squeezelite's
supported PortAudio `Name [Core Audio]` identifiers instead of fragile numeric
indices where names distinguish devices. The current system default's friendly
name is read using `system_profiler SPAudioDataType -json`.

Changes update only `ProgramArguments`'s `-o` value in the existing managed
`~/Library/LaunchAgents/org.randy.squeezelite.plist`. Other arguments and launchd
options are preserved. The configuration is backed up, written atomically and
validated with plutil. The managed job is booted out, its old PID is allowed to
exit, and the same job is bootstrapped. Failed startup restores the old config
and attempts recovery. No unmanaged audio player or LMS process is spawned.
The installer preserves the selected output when refreshing its template.

Randy persists `{id, name, platform}` in `settings.squeezeliteOutput`. The host
service configuration is authoritative. Saved macOS identifiers are not reused
as Linux identifiers.

The Debian path enumerates ALSA identifiers such as `hw:CARD=DAC,DEV=0`, writes
`SL_SOUNDCARD` in `/etc/default/squeezelite`, and restarts only
`squeezelite.service`. These are existing Debian conventions; no OS packaging,
systemd units or privilege policy was installed here. Production deployment must
grant the Randy service permission to update that configuration and restart that
one service. Linux behavior was exercised with controlled tests, not Debian
hardware.

References:
[Squeezelite PortAudio implementation](https://github.com/ralph-irving/squeezelite/blob/master/output_pa.c),
[Debian configuration](https://sources.debian.org/src/squeezelite/2.0.0-1517%2Bgit20241227.262994a-1/debian/squeezelite.squeezelite.default/).

## Connect diagnosis and recovery

SpotOn 3.5.8/helper 3.0.2 reported valid account and playback authorization, a live
Connect-enabled helper and a valid session. Per-player format remains PCM.
The user confirmed audible Connect playback. Native next changed the track and
the persistent notice followed it; selecting a Randy local item cleared it.

One check observed LMS position remaining zero. The helper logged a stale
`relay_active` takeover and later `relay_active stuck for >60s — force-clearing`.
This is evidence of remaining SpotOn relay/session flakiness, not proof of an
authentication failure or a Randy ownership bug. No ownership redesign or new
plugin patch was made for this cleanup. The earlier local SpotOn seek correction
is separate and remains documented in `spoton-seek-fix.patch`.

Supported recovery, without deleting credentials or changing audio layers:

1. In Spotify, switch to this computer/phone, then select Randy again to establish
   a fresh session.
2. If playback authorization is missing/expired, open Configure Spotify and use
   Authorize/Reauthorize playback in SpotOn. Valid authentication did not require
   reauthorization during this check.
3. For a stuck player, restart the managed Squeezelite job:
   `launchctl kickstart -k gui/$(id -u)/org.randy.squeezelite`.
4. If the SpotOn helper itself remains stuck, use LMS's supported restart/settings
   controls. Randy does not start or manage LMS.

Connect worked after the Squeezelite output-change restarts, but this does not
establish that restarting Squeezelite fixes every intermittent failure.

## Targeted validation

- 138 targeted automated tests passed across item rendering, Spotify UI/service,
  ownership notifications, output configuration and affected server wiring.
  The final toast/rendering subset (71 tests) also passed after live-region
  deduplication. No full playback/library/radio/MPV soak was repeated.
- Short actual Chrome walkthrough: 20 checks passed with real LMS/SpotOn,
  including simplified Settings, device selection, Air search, local/Spotify
  rendering parity, no playlist results, playback, 640px artwork and queue parity.
- Reversible native configuration check: system default -> explicitly named
  MacBook Pro Speakers -> original default. Randy stayed running. There was no
  safe alternate physical DAC; the Zoom virtual output was left untouched.
- Live Connect browser check: 11 checks passed, including persistence beyond the
  old timeout, one notice, a real track change and Randy takeover. The user
  confirmed audible Connect playback.
- A final render-only Chrome check verified the corrected Connect row, preserved
  queue source icon and mobile Settings layout without changing playback.
- Changed JavaScript syntax, installer shell syntax and `git diff --check` passed.

Tests used isolated Randy databases. No Spotify credentials, real music library
or queue databases were changed. The original Squeezelite output was restored;
no global macOS audio-output setting was changed. Nothing was committed.
