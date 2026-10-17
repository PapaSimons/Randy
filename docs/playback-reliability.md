# Playback service reliability

## Diagnosis on this Mac (2026-10-17)

LMS 9.1.1 was reachable, but no Squeezelite process/LaunchAgent was running.
A global JSON-RPC `serverstatus` query succeeded. Querying `status` for the
unknown player `02:52:41:4e:44:59` closed the HTTP connection, producing Node's
`TypeError: fetch failed` / `UND_ERR_SOCKET`. With LMS stopped, the same outer
error had cause `ECONNREFUSED`. The original one-line log omitted the cause;
that historical line alone cannot identify which condition applied.

The previous adapter reported both as `playback-error`, polled every 250 ms,
and forgot unsuccessful load requests. A rejected initial `connect()` also
prevented Randy's startup volume/play-on-start initialization. Existing EOF
guards prevented queue advancement, but restoring the services did not reload
or resume the selected track. Real tests reproduced all seven startup/restart/
player-disconnect cases using copied Randy code and isolated databases.

| Reproduced case | Previous behavior | Corrected behavior |
| --- | --- | --- |
| Randy starts with LMS stopped | Server stays up, startup initialization fails | Initializes and retains the selected request |
| LMS starts later | Status recovers, failed load is forgotten | Discovers/revalidates the player and restores the request |
| LMS stops during playback | Connection reported as playback error, no skip | Connection state changes; position/intent retained, no skip |
| LMS restarts | Selected local track stays stopped | Reloads the same file and restores position |
| LMS up, player absent | Socket failure for unknown ID or player error | Global discovery reports waiting for player |
| Player connects later | Failed request does not replay | Current request loads automatically |
| Player disappears/reconnects | No automatic local-track restoration | Revalidates and restores the current request |

## Recovery contract

- `connect()` initializes monitoring even when services are unavailable.
- `connection-change` reports `connecting` (initial snapshot), `connected`,
  `lms-unavailable`, `waiting-for-player`, and `closed` (adapter shutdown).
  `getStatus().connectionState` and the additive Socket.IO `player-connection`
  event expose this state. The existing `problem` notification signals outages;
  no frontend files change. Media state/position remain cached while disconnected.
- Discover the configured player with global `players` before querying an
  unavailable player. Revalidate after every outage.
- Transport, timeout, HTTP/JSON-RPC/protocol failures and absent players remain
  pending, never emit media completion, and retry at 1, 2, 4, 8, 12, 12… seconds.
  Healthy status polling remains 250 ms. Successful recovery resets backoff.
  Log connection transitions, not every failed poll.
- Only the current playback ID may recover. Replacement supersedes pending work;
  manual stop cancels the load and applies the pending stop once reachable.
  Closing cancels timers and in-flight HTTP requests without stopping services.
- Restore Randy's latest volume, reload only its selected track, and disable LMS
  shuffle/repeat. Restore seekable local files near the last observed position,
  with up to 750 ms replay near EOF to require a fresh witnessed completion.
  Honor pause/seek requests made during the outage. Live streams restart, without
  attempting to seek. Recovery may replay audio since the last 250 ms observation;
  it is not gapless. Nonseekable files restart from the beginning.
- Invalid input and a radio startup failure while LMS/player remain healthy are
  media failures. The radio startup timer is suspended by infrastructure loss.
  Post-start live-stream termination versus an external stop remains ambiguous;
  that stopped state does not automatically advance Randy's queue.

## macOS development services

LMS's built-in **Run Service Automatically** option was initially disabled:
its LaunchAgent and legacy startup preference were absent. During validation the
vendor agent appeared; the final check confirms it is now enabled
(`com.slimdevices.slim StartupMenuTag=1`) and running through
`~/Library/LaunchAgents/org.lyrion.lyrionmusicserver.plist` with `RunAtLoad=true`.
The updater agent is separate. Use the LMS menu for this setting; no second LMS
supervisor is installed by Randy. The vendor agent has no `KeepAlive` setting:
login startup is enabled, but automatic LMS crash respawn is not established.
Randy keeps waiting if LMS stays down. Debian's systemd policy below provides
crash supervision. Restart tests preserve the native settings and use isolated
Randy databases, not the real Randy library DB.

Install the separate user LaunchAgent as the logged-in account, without sudo:

```sh
scripts/macos/install-squeezelite.sh --install
scripts/macos/install-squeezelite.sh --status
# To deliberately disable it:
scripts/macos/install-squeezelite.sh --uninstall
```

It runs the native Squeezelite executable in the foreground with `-n Randy
-s 127.0.0.1 -m 02:52:41:4e:44:59 -o default`. `RunAtLoad`, `KeepAlive` and a
10-second launch throttle handle login and process exits. Logs go to
`~/Library/Logs/Randy/`. The installer rejects manual/legacy instances and
reinstalling unchanged settings keeps the same job. Do not also launch the
Squeezelite application manually. Randy never spawns or manages this process.
This is a login-session agent, not a system boot daemon; it stops at logout and
does not provide pre-login/FileVault audio. It does not change audio settings.

Sources: [Apple launchd guide](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html),
[Lyrion macOS guide](https://lyrion.org/getting-started/mac-install/).

## Intended Debian design (documentation only)

Enable `lyrionmusicserver.service`, `squeezelite.service` and `randy.service` for
`multi-user.target`. Prefer distribution/vendor units and small drop-ins rather
than replacing the packaged units. Confirm the actual LMS package unit name on
the target distribution. Use foreground processes under systemd; keep runtime
DB state writable by the dedicated service account and grant only required
library/audio permissions. Squeezelite uses direct ALSA on Debian.

| Service | Ordering | Optional dependencies | Restart policy |
| --- | --- | --- | --- |
| lyrionmusicserver | `After=network.target` | none for local playback | `Restart=always`, `RestartSec=5s` |
| squeezelite | `After=network.target sound.target lyrionmusicserver.service` | `Wants=lyrionmusicserver.service` | `Restart=always`, `RestartSec=5s` |
| randy | `After=network.target lyrionmusicserver.service squeezelite.service` | `Wants=lyrionmusicserver.service squeezelite.service` | `Restart=always`, `RestartSec=5s` |

`After=` orders startup/shutdown; it does not prove API/player readiness.
`Wants=` pulls up local companion services without stopping Randy if they fail.
Avoid `Requires=`/`BindsTo=` between these services: their temporary absence is
recoverable and must not tear down Randy. Do not require `network-online.target`
for local playback or block boot with connectivity/HTTP wait loops. Internet access must not hold local-service startup. Configure suitable start limits (for example
`StartLimitIntervalSec=60`, `StartLimitBurst=20`), with restart delays, so transient
failures do not exhaust a tight default limit. For an appliance requiring
indefinite retries, deliberately configure `StartLimitIntervalSec=0` instead.
Use `Restart=always` to cover unexpected clean exits as well as crashes; an
explicit `systemctl stop` still stops the service. LMS/Squeezelite restart
supervision and Randy's connection recovery are separate.

Sources: [systemd service settings](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html),
[unit ordering/dependencies](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html),
[network startup guidance](https://systemd.io/NETWORK_ONLINE/).

## Validation

Run `node --test test/*.test.js`, `node --check` on changed JavaScript,
`bash -n scripts/macos/install-squeezelite.sh`, and
`plutil -lint scripts/macos/org.randy.squeezelite.plist` on macOS.
The automated tests use simulated transport/player state and controlled timers;
they do not stop real services. Real macOS tests use an isolated `/private/tmp`
Randy instance, copied databases and a safe repeated system notification sample.
They intentionally stop/restart LMS and Squeezelite; never run such restart tests
against an unattended production session.

Real validation on 2026-10-17 passed: seven baseline startup/disconnect cases,
24 corrected restart checks, eight launchd installation/duplicate/crash checks,
eight real default-MPV checks, and a combined managed-service test confirming
fresh Socket.IO position progress after player respawn and LMS/radio restart.
The combined test advances once at a deliberate local EOF and never advances
because of infrastructure loss. No audible confirmation was requested in this
resilience run; verification uses native player clocks and Randy's Socket.IO.

## Graceful Randy shutdown

Ctrl+C (`SIGINT`) and `SIGTERM` stop the selected LMS player before closing
the adapter and exiting. Cleanup waits at most four seconds for the stop
operation, then closes the adapter to abort pending requests and retries.
Late completion events cannot advance the playlist during shutdown. LMS and
Squeezelite services remain running. MPV retains its existing close behavior.
A forced kill or crash cannot guarantee cleanup; an unreachable LMS cannot
receive a stop command. Adapter `close()` alone remains a disconnect operation
so backend replacement does not acquire shutdown-specific side effects.
