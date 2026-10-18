'use strict';
const media = require('./spotify-item');

module.exports = function registerSpotifyRoutes(app, { spotify, playlist, backend, playSong, getPlaybackId = () => null, onAccountRemoved }) {
    require('./spotify-settings-routes')(app,{spotify,playlist,onAccountRemoved});
    let latestPlayRequest = 0;
    const route = (path, handler) => app.post(path, async (req, res) => {
        try { res.json(await handler(req.body || {})); }
        catch (error) {
            spotify.log?.('request-error',{operation:path.split('/').pop(),category:require('./spotify-log').category(error),
                code:typeof error.code === 'number' ? error.code : undefined});
            res.status(400).json({ error: error.message });
        }
    });
    route('/spotify/client-id', body => spotify.setClientId(body.clientId));
    route('/spotify/status', async () => ({ ...await spotify.status(), playbackAvailable: backend === 'lms' }));
    route('/spotify/search', async body => ({ query: String(body.keyword || ''), results: await spotify.search(body.keyword) }));
    route('/spotify/browse', body => spotify.browse(body.key, body.all !== false));
    route('/spotify/preference', async body => {
        if (typeof body.enabled !== 'boolean') throw new Error('Search preference must be on or off');
        playlist.setSetting('spotifySearchEnabled', body.enabled);
        spotify.statusCache = null;
        return { success: true };
    });
    route('/spotify/queue', async body => {
        if (backend !== 'lms') throw new Error('Spotify playback requires the LMS backend');
        if (!['play', 'add', 'sticky'].includes(body.action)) throw new Error('Unknown Spotify action');
        const request = body.action === 'play' ? ++latestPlayRequest : null;
        const playbackId = getPlaybackId();
        const status = await spotify.status(true);
        if (!status.connected) throw new Error(status.state === 'auth-expired' ? 'Spotify needs to reconnect' : 'Spotify is not connected');
        if (body.action === 'play' && status.playbackAuthorized === false) throw new Error('Authorize Spotify playback in SpotOn settings');
        if (body.action === 'sticky' && body.key) {
            await playlist.addtosticky(spotify.albumBookmark(body.key));
            return {success:true, count:1};
        }
        const collection = !!(body.key || body.album);
        const contents = body.album ? await spotify.browseAlbum(media.album(body.album)) : collection ? await spotify.browse(body.key, true) : null;
        if (contents && contents.enumerable === false) throw new Error(contents.message || 'SpotOn did not expose the complete collection');
        const items = collection ? contents.items.filter(i => i.song).map(i => i.song) : [media.song(body.song)];
        if (!items.length) throw new Error('This Spotify collection has no playable tracks');
        if (body.action === 'play' && (request !== latestPlayRequest || playbackId !== getPlaybackId())) return {success:false, cancelled:true, count:0};
        if (body.action === 'sticky') {
            if (collection) throw new Error('Only Spotify track stickies are supported');
            await playlist.addtosticky(items[0]);
        } else {
            const selected = playlist.queueSpotify(items, body.action === 'add' ? 'append' : collection ? 'replace' : 'insert');
            if (body.action === 'play') await playSong(selected);
        }
        return { success: true, count: items.length };
    });
    app.get('/spotify/artwork', async (req, res) => {
        try {
            const image = await spotify.image(req.query.url, req.query.size == null ? 640 : req.query.size);
            res.set('Content-Type', image.type);
            res.set('Cache-Control', 'public, max-age=86400');
            res.send(image.bytes);
        } catch {
            res.redirect('/IMG/Record.png');
        }
    });
};
