#!/bin/bash
# User LaunchAgent: run from the logged-in Mac account, without sudo.
set -euo pipefail
label=org.randy.squeezelite
domain="gui/$(id -u)"
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
binary=/Applications/Squeezelite.app/Contents/MacOS/Squeezelite
target="$HOME/Library/LaunchAgents/$label.plist"
log_dir="$HOME/Library/Logs/Randy"

if [ "$(uname -s)" != Darwin ] || [ "$(id -u)" = 0 ]; then
    echo 'Run this as the logged-in macOS user, without sudo.' >&2
    exit 1
fi
case "${1:---install}" in
    --status) launchctl print "$domain/$label"; exit ;;
    --uninstall)
        if launchctl print "$domain/$label" >/dev/null 2>&1; then launchctl bootout "$domain/$label"; fi
        if [ -f "$target" ]; then rm -- "$target"; fi
        echo 'Removed the Randy Squeezelite LaunchAgent.'
        exit ;;
    --install) ;;
    *) echo "Usage: $0 [--install|--status|--uninstall]" >&2; exit 1 ;;
esac
[ -x "$binary" ] || { echo "Missing Squeezelite executable: $binary" >&2; exit 1; }
launchctl print "$domain" >/dev/null

# A single installation lock also prevents two copies of this installer racing.
lock_dir="${TMPDIR:-/tmp}/randy-squeezelite-install.lock"
mkdir "$lock_dir" 2>/dev/null || { echo "Installer already running: $lock_dir" >&2; exit 1; }
staged="$(mktemp "${TMPDIR:-/tmp}/randy-squeezelite.XXXXXX")"
trap 'rm -f -- "$staged"; rmdir "$lock_dir"' EXIT

# Refuse other supervisors/manual instances rather than starting duplicates or
# terminating an unrelated player. An already loaded instance of our job is OK.
for scope in "$domain/squeezelite" system/squeezelite system/org.randy.squeezelite; do
    if launchctl print "$scope" >/dev/null 2>&1; then
        echo "Another Squeezelite job exists ($scope). Unload it before installing this one." >&2
        exit 1
    fi
done
own_pid="$(launchctl print "$domain/$label" 2>/dev/null | awk '/^[[:space:]]*pid = / {print $3; exit}' || true)"
for pid in $(pgrep -ix squeezelite || true); do
    if [ "$pid" != "$own_pid" ]; then
        echo "Squeezelite PID $pid is already running outside this job. Stop it first; no duplicate was started." >&2
        exit 1
    fi
done
cp "$script_dir/$label.plist" "$staged"
# Preserve the output selected in Randy when refreshing this managed template.
if [ -f "$target" ] && [ "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:7' "$target" 2>/dev/null || true)" = '-o' ]; then
    selected_output="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:8' "$target")"
    plutil -replace ProgramArguments.8 -string "$selected_output" "$staged"
fi
plutil -replace StandardOutPath -string "$log_dir/squeezelite.out.log" "$staged"
plutil -replace StandardErrorPath -string "$log_dir/squeezelite.err.log" "$staged"
plutil -lint "$staged"

# Re-running an unchanged installation leaves the existing player uninterrupted.
if [ -f "$target" ] && cmp -s "$target" "$staged" && launchctl print "$domain/$label" >/dev/null 2>&1; then
    echo "$label already installed and loaded."
    exit
fi
if launchctl print "$domain/$label" >/dev/null 2>&1; then
    launchctl bootout "$domain/$label"
    if [ -n "$own_pid" ]; then
        for attempt in {1..50}; do
            kill -0 "$own_pid" 2>/dev/null || break
            sleep 0.1
        done
        if kill -0 "$own_pid" 2>/dev/null; then echo 'Previous player has not exited; refusing a duplicate.' >&2; exit 1; fi
    fi
fi
mkdir -p "$(dirname -- "$target")" "$log_dir"
if [ -f "$target" ]; then cp -p "$target" "$target.backup.$(date +%Y%m%d%H%M%S)"; fi
install -m 644 "$staged" "$target"
launchctl enable "$domain/$label"
launchctl bootstrap "$domain" "$target"
echo "Installed $target (login startup, foreground process supervised by launchd)."
launchctl print "$domain/$label"
