# Native Spotify settings

Randy provides account setup, playback pairing, Client ID configuration and a
search preference. SpotOn remains the credential authority. Randy does not read
credential files, implement Spotify API calls, or persist OAuth tokens.

## Supported interfaces

The native controls currently target the installed SpotOn 3.5.8. Mutations are
disabled for unverified plugin versions rather than guessing their interfaces.
All paths below are under `/plugins/SpotOn/` on LMS.

- `status/data`: account and playback authorization health.
- `settings/pkce/start` and `settings/pkce/manual`: SpotOn creates PKCE state,
  verifies the callback and exchanges/stores credentials.
- `settings/playerauth/start`, `status`, `cancel`: playback pairing and progress.
- `settings/playerauth/browser/start` and `manual`: secondary browser pairing.
- LMS `pref` / `playerpref`: account profile, active account and Client ID mode.

Account removal and Client ID updates lack dedicated JSON operations. Randy
posts the narrow existing `settings/basic.html` form handler, preserving public
preferences it writes unconditionally. It verifies results through LMS prefs;
it does not scrape HTML or manipulate credential files.

## Browser orchestration

Account setup opens Spotify from an explicit click. The original SpotOn PKCE
state points at Randy's callback route, which forwards completion to SpotOn.
Only the PKCE-start request uses Node HTTP directly to preserve the callback
Host header. No OAuth state is rewritten. Pending state is memory-only, bound
to the initiating request, expires after three minutes and is cancelled on retry.
Status polling and focus refresh update Randy after consent. The callback page
contains no credential data. Browser fallback accepts a return URL transiently,
clears its input and forwards it to SpotOn without logging or persisting it.

The installed custom-client redirect is
`https://stiefenm.github.io/spoton/auth/`; browser playback uses
`http://127.0.0.1:18764/login`. Remote browsers may need the provided return-URL
fallback. Client ID changes are global SpotOn settings and invalidate account
Web API authorization; playback credentials have independent health.

The search checkbox uses Randy's existing settings store. Disabling it suppresses
Spotify searches without disabling direct browsing or Spotify Connect.

## Validation

Focused Node tests cover sanitization, auth lifecycle, pairing, preference
changes, errors and frontend state. Desktop and 390px browser checks cover native
controls. Real account setup and playback pairing were completed from Randy and
confirmed by the user; both persisted health flags were then verified. Removal
and changing to a different Client ID use fixtures to preserve working access.
