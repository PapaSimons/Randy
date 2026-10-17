# LMS audio metadata

Randy requests `tags:uNoTIHr` in the current player's LMS status. The current
`playlist_loop` entry supplies source `type`, `samplerate` (Hz), `samplesize`
(bits), `channels`, and `bitrate` (LMS's formatted, unit-bearing string).
The adapter formats these into the existing Socket.IO `audiostats` string,
for example `FLAC 48kHz 24bit 1673kbps`. LMS's `flc` type is
displayed as `FLAC`. MPV retains its existing formatter.

Missing, zero, or invalid numbers are omitted. Bitrates require explicit units;
an unlabelled plugin number has ambiguous units and is omitted. No values come
from filenames, station names, file-size estimates, or output-device settings.
Plugin metadata uses the same LMS fields without plugin-specific integration.
LMS may expose fewer fields for radio: the tested SomaFM MP3 stream supplied
type/bitrate, while Radio Paradise AAC supplied type/sample rate but bitrate `0`.

The adapter clears the string when a new playback request is accepted. Existing
playback ID, request generation, and URL checks reject stale metadata. An empty
string clears the unchanged frontend display.

## Source versus output

These values describe the source; they do not establish physical output format
or bit-perfect playback. No separate current device sample-rate/sample-format
field was found in the inspected LMS 9.1.1 status query implementation.

[Squeezelite's PortAudio implementation](https://github.com/ralph-irving/squeezelite/blob/master/output_pa.c)
requests `paInt32` samples and logs the opened stream's rate using
`Pa_GetStreamInfo(...)->sampleRate` at output info log level. This is a client
diagnostic, not an LMS JSON-RPC output-format API, and does not establish the
physical CoreAudio device format. Reporting it would require separate client
telemetry or log collection, so Randy does not implement it or change
Squeezelite logging/audio settings here.

The display uses spaces between fields and omits channel count. Metadata is
checked on every status poll (normally 250 ms); changed bitrates are published
immediately. LMS local-file bitrate is track metadata, not an instantaneous
frame bitrate, so VBR files generally display a fixed track bitrate. Remote
values update only when the stream handler supplies updated metadata. Randy
does not estimate a fluctuating bitrate from network traffic or decoded audio.
