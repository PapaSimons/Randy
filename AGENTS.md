# Repository Guidelines

# Randy LMS Migration

## Goal

Migrate Randy from MPV-based playback to Lyrion Music Server (LMS)
with Squeezelite, while preserving Randy's existing UI, randomizer,
stickies, and overall behavior.

Target architecture:

Randy Node.js app
    -> LMS API
    -> Lyrion Music Server
    -> Squeezelite
    -> native audio output

## Development targets

- macOS is the primary development environment.
- Minimal Debian Linux is the production appliance target.
- Linux production audio should use direct ALSA access.
- Avoid PulseAudio and PipeWire unless there is a strong technical reason.
- Keep dependencies minimal.

## Migration rules

- Do NOT remove MPV yet.
- Add LMS as a second playback backend first.
- Preserve the existing Randy frontend unless changes are necessary.
- Preserve Randy randomizer and stickies behavior.
- Separate Randy logic from playback implementation.
- Do not rewrite unrelated code.
- Prefer small, incremental commits.
- Do not introduce Docker.
- Do not redesign the application yet.

## Phase 1 objective

Understand the existing playback architecture and propose the smallest
clean abstraction that allows both MPV and LMS playback backends.

Do not implement the migration until the architecture has been reviewed.

## Project Structure & Module Organization

Randy is a Node.js music player for Raspberry Pi, Linux, and macOS. `index.js` runs the Express server, HTTP API, and Socket.IO integration. `lib/` contains playlist and metadata handling (`playlist_utils.js`), MPV process/IPC integration (`mpv-wrapper.js`), and radio URL discovery.

The browser interface lives in `public/index.html`, with application JavaScript in `public/JS/`, styles in `public/CSS/`, and images in `public/IMG/`. `DB/` stores runtime JSON databases for songs, metadata, playlists, and settings. Installation and maintenance scripts live at the repository root; `.github/workflows/` contains OS image automation.

## Build, Test, and Development Commands

- `npm ci`: install dependencies from `package-lock.json`.
- `PORT=3000 npm start`: run the server locally at `http://localhost:3000`; the default port is 80.
- `node --check index.js`: check server syntax. Run the same command on changed JavaScript files.
- `bash -n install.sh update.sh update_mpv_alsa.sh`: check maintenance script syntax without executing them.

Install `mpv` for the legacy playback backend. Web URLs must point directly to playable audio or radio streams; webpage playback is not supported. There is no separate frontend build step or configured `npm test`/lint script. Check startup output for missing dependencies before testing playback.

## Coding Style & Naming Conventions

Use CommonJS modules for server code and preserve the browser's existing plain JavaScript/jQuery conventions. Match nearby formatting: most application code uses four spaces and semicolons, while `mpv-wrapper.js` uses tabs and largely omits semicolons. Use descriptive camelCase identifiers and follow existing filenames. Avoid unrelated formatting changes and edits to bundled third-party scripts.

## Testing Guidelines

No automated test framework or coverage threshold is configured. Validate changes manually with local audio and an online radio source. Check affected playback controls, playlist/sticky behavior, settings persistence, and browser/server logs. For UI changes, check desktop and mobile layouts. Document reproduction steps and validation results in the pull request.

## Commit & Pull Request Guidelines

Recent commits use short, informal descriptions such as `playlist fixes`; no enforced prefix convention is evident. Write concise, specific summaries and keep each commit focused. Pull requests should explain the problem, resulting behavior, affected platforms, and checks performed. Link relevant issues and include screenshots for visible UI changes.

## Configuration & Runtime Data

Keep generated `DB/*.json` files out of commits and back them up before persistence changes. Installation/update scripts modify system packages and services; inspect them before running on a development machine.
