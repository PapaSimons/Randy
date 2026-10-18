# Spotify Connect recovery

Randy does not restart SpotOn during ordinary track changes. At a confirmed
Connect → Randy ownership handoff, it now refreshes the configured helper after
LMS stop/clear is verified. Local/radio playback starts first and the refresh
runs in the background; these sources do not use SpotOn. Randy Spotify tracks
still wait for helper readiness. This intentional boundary refresh is not
suppressed by the stall-recovery cooldown; helper operations are serialized. Local-to-local and other ordinary
queue changes never trigger it. SpotOn already
supervises its helper and checks invalid/stale sessions itself.

If LMS reports a live Connect item as playing with an unchanged position for
25 seconds, Randy can cycle Connect through SpotOn's per-player settings form.
This restarts only the configured player's SpotOn helper, not LMS, Squeezelite
or Randy. Requests share one in-flight operation and have a five-minute cooldown.
Paused/stopped playback, local files, radio and progressing Connect tracks are
excluded. Changing track or ownership cancels a recovery that has not started.
Once Connect is disabled, restoration is always attempted. New local/radio
loads can proceed alongside it; a Spotify load waits for restoration. PCM, bitrate, discovery and autoplay preferences are preserved.
If LMS becomes unreachable during restoration, the failure is logged; Connect
may need re-enabling in SpotOn settings after LMS returns.

A restart repairs the helper/device advertisement; it does not transfer or
resume Spotify's queue. Select Randy again in Spotify if necessary. A device
picker failure that never creates an LMS Connect item is not observable by this
stall detector. The heuristic detects frozen progress, not audibility or every
possible Spotify session failure.

Console events include `[Spotify] connect-restart` (starting/ready) and sanitized
`connect-restart-error` diagnostics. No credentials or stream URLs are logged.

Validation: mocked lifecycle/cancellation/cooldown/settings-preservation tests;
real Mac player-settings off/on cycle while playback was paused confirmed a
new helper PID, Connect enabled and PCM/discovery/autoplay preserved. A real stopped Connect handoff through the current ownership module also
confirmed queue release, a fresh helper PID and Connect re-enabled. Audible
Connect → local → Connect verification is still pending with the updated app.
