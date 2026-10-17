# Spotify content access through SpotOn

Validated on 2026-10-17 with LMS 9.1.1, SpotOn 3.5.8/helper 3.0.2,
the authenticated personal Client ID, and player `02:52:41:4e:44:59`.
SpotOn streaming format remains PCM. Randy never contacts Spotify's API or
reads/stores its authorization tokens.

## Observed capabilities

| Operation | Current result |
| --- | --- |
| Track search, metadata, individual playback | Works through Randy and LMS |
| Album search metadata/artwork/year | Works |
| Album children | Works: Magical Mystery Tour (Remastered 2009), 11 tracks; 1 (Remastered 2015), 27 tracks |
| Playlist search metadata/title/owner/artwork | Works, independently of permission to read contents |
| Owned playlist children | Works: Aba, 563 tracks; fully enumerated and queued in Randy |
| Public playlist children | Tested Beatles playlists and saved Mamma Mia playlist fail; SpotOn logs HTTP 403 for `/playlists/<id>/items` |
| Artist albums | Works: Beatles Albums returned 25 items; Singles/Compilations/Appears On menus also exposed |
| Artist top tracks | Not exposed; installed SpotOn deliberately omits this removed Development Mode endpoint |
| Liked Songs | Works: LMS advertised 234 saved tracks; first page read successfully |
| Home recommendations | Recently Played and the account's Top Tracks work; these are not artist Top Tracks |
| Made For You / Daily Mixes | Absent from this account's current Home menu |

The HTTP 403 is not a universal ban on playlist access: the authenticated
account's own Aba playlist works. Public playlist metadata can be searchable
while its contents are inaccessible. No LMS browse path tested bypassed that
restriction. Empty LMS responses do not reliably distinguish an empty playlist
from a permission failure, so Randy reports that distinction honestly.

SpotOn's Made For You path is separately gated on its Web Player configuration
(`sp_dc`), and uses a different token path inside the plugin. No cookies or
additional authentication were requested, read or configured for this phase.

## LMS commands

Send HTTP JSON-RPC to `/jsonrpc.js`:

```json
{"id":1,"method":"slim.request","params":["02:52:41:4e:44:59",["spoton","items","0","50","menu:1","want_url:1"]]}
```

All content discovery uses the plugin's ordinary `spoton items` command.
Follow the server-issued `actions.go.params.item_id` or item `params.item_id`;
never forward its play/add/context actions as read-only navigation.

Examples from this installation (menu indices are dynamic):

```text
spoton items 0 50 menu:1 want_url:1
spoton items 0 50 menu:1 want_url:1 item_id:1
spoton items 0 50 menu:1 want_url:1 item_id:1.0 search:Beatles
spoton items 0 8 menu:1 want_url:1 item_id:1.0_Beatles.2
spoton items 0 100 menu:1 want_url:1 item_id:<resolved-album-or-playlist-path>
spoton items 100 100 menu:1 want_url:1 item_id:<same-collection-path>
```

The first commands discover Search and New Search; the next opens search types,
then Albums. The artist result opens Albums, Singles, Compilations and Appears
On. Library exposes Liked Songs, Albums, Artists and Playlists. Home exposes
Recently Played and the account's Top Tracks. These are the same menu feeds
used by LMS, accessible through CLI or JSON-RPC; no separate public SpotOn
`album-tracks` or `playlist-tracks` RPC was found.

For an individual album track, omit `menu:1` and request its leaf item path:

```text
spoton items 0 1 want_url:1 item_id:<album-path>.0
```

`loop_loop[0]` supplies original title, artist, album, image, duration in seconds
and the stable track URL. Compact menu rows omit several of these fields.
Playlist rows already expose title/artist/album/artwork; missing durations are
omitted rather than issuing hundreds of leaf requests. Playback status supplies
the current track's duration when available.

## Correct album identity

An existing Randy bug was reproduced: opening the first Beatles album search
result (Magical Mystery Tour) enumerated Abbey Road. XMLBrowser reconstructs
coderef parents using single-item requests; Spotify's broad search results can
change with limit/offset. Positional menu paths alone are not item identities.
An explicit XMLBrowser session did not fix this installation's coderef behavior.

Randy now resolves an album with an edition-specific `album:"title" artist:"name"`
search through SpotOn, checks that its first single-item result has the exact
selected stable URI, and follows that verified path. If identity cannot be
verified, it refuses to import rather than queue another album. Leaf URIs are
also checked before attaching metadata/artwork. This conservative resolver may
decline ambiguous releases; it does not promise every catalog edition resolves.

For playlists, an exact-title search is checked in the same way. A mismatch
can fall back to the authenticated account's Library playlist list, matching
the stable URI. This made the owned Aba playlist accessible even though search
ranking differed. No additional Spotify endpoints are implemented in Randy.

## Randy representation and queue

The existing schema is retained:

```js
{
  type: 'spotify',
  source: 'spotify',
  songfile: 'spoton://track:0qHMhBZqYb99yhX9BHcIkV',
  parentUri: 'spoton://album:2BtE7qm1qzM80p9vLSiXkj',
  albumart: '/spotify/artwork?url=<encoded-public-artwork-url>',
  tags: {
    common: {
      title: 'Magical Mystery Tour - Remastered 2009',
      artist: 'The Beatles',
      album: 'Magical Mystery Tour (Remastered 2009)'
    },
    format: { duration: 170.106 }
  }
}
```

Track, album and playlist identity is `spoton://<type>:<22-character Spotify ID>`;
the corresponding Spotify URI is `spotify:<type>:<same ID>`. No temporary audio
URL is stored. Optional `parentUri` identifies an album/playlist without giving
it queue ownership. Search-container handles are ephemeral and must be
rediscovered after restart. Artist menus do not expose a stable artist URI in
this interface, so artist navigation is not persisted.

Stable track IDs, metadata and public artwork survive Randy persistence;
sticky playback and artwork were tested after a real Randy restart. Stable
URIs are also suitable after LMS restart provided authorization remains valid;
LMS restart was not repeated during this phase.

Search keeps LOCAL plus the four Spotify groups and track Play/Add/Sticky.
Verified complete collections expose Play/Add and expand into individual Randy
items. Restricted, empty or unresolved collections retain metadata and an
**Open in Spotify** link, with no misleading Randy import/play controls. This
link opens Spotify; it does not claim playback started or that Randy owns its
queue. Collection expansion is bounded at 2000 entries and rejects incomplete
enumeration before mutating the queue.

Artwork remains public Spotify artwork through Randy -> LMS imageproxy, with
the normal placeholder fallback. Existing playbackId and browser-generation
guards remain in use. Connect metadata is displayed separately from Randy's
retained queue.

## Audio information

SpotOn `_typeString` describes the helper's transport format. `_bitrateForClient`
uses LMS stream bitrate when available, otherwise its configured quality tier.
The returned status does not distinguish these provenances or expose verified
original Spotify source quality. In PCM mode, neither proves an original OGG
encoding or source bitrate. Randy therefore displays **Spotify** in audiostats
for SpotOn playback. Local/radio and MPV formatting remain unchanged; actual
output/DAC information stays separate. No bit-perfect claim is made.

## Validation

- 222 automated tests passed; syntax and diff-whitespace checks passed.
- Real Chrome: 42 checks passed without menu fixtures. Track search Play/Add,
  metadata/artwork, local -> Spotify -> radio -> Spotify, album Play/Add,
  next/previous, public playlist limitation, owned playlist Play/Add, and sticky
  playback/artwork after Randy restart were exercised in isolated state.
- Album queue had 11 individual items, then 22 after Add. Owned playlist Add
  appended 563 items; Play replaced the queue with 563. LMS retained one item.
- Separate Connect Chrome check passed 11 checks. The user confirmed fresh
  Connect audio and audible Resume after a Randy local-track handoff with PCM.
- Native MPV smoke test passed all seven checks including EOF advancement.
- Real Randy databases, Spotify credentials, plugin code and PCM configuration
  were not changed by these tests. No direct Spotify Web API calls were added.

Spotify documents the removal of Artist Top Tracks in its
[February 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/february-2026).
The playlist permission conclusions above are measurements of this installed
account, not an assertion that every playlist or Development Mode app behaves
identically.
