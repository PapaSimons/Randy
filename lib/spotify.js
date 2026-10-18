'use strict';

const { randomUUID } = require('node:crypto');
const media = require('./spotify-item');
const clean = value => typeof value === 'string' ? value.slice(0, 2000) : '';

class Spotify {
    constructor(options = {}) {
        this.log = options.log || require('./spotify-log').createLog();
        this.base = new URL(options.serverUrl || 'http://127.0.0.1:9000');
        this.playerId = options.playerId || '';
        this.fetch = options.fetch || globalThis.fetch;
        this.getSettings = options.getSettings || (() => ({}));
        this.setSetting = options.setSetting || (() => {});
        this.timeout = options.timeout || 8000;
        this.cache = new Map();
        this.handles = new Map();
        this.statusCache = null;
        this.blockedUntil = 0;
        this.blockedMessage = 'Spotify search is temporarily unavailable';
        this.api429Count = 0;
        this.ownership = new (require('./spotify-ownership').Ownership)(this);
        this.recovery = new (require('./spotify-recovery').ConnectRecovery)(this);
    }

    async request(path, options = {}) {
        const response = await this.fetch(new URL(path, this.base), { ...options, signal: AbortSignal.timeout(this.timeout) });
        if (!response.ok) throw Object.assign(new Error('LMS request failed'), { code: response.status });
        return response;
    }

    async rpc(command, player = this.playerId) {
        if (!this.playerId) throw new Error('LMS player is not configured');
        const response = await this.request('/jsonrpc.js', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 1, method: 'slim.request', params: [player, command] }) });
        const body = await response.json();
        if (body.error || !body.result) throw new Error('LMS command failed');
        return body.result;
    }

    async status(force = false) {
        if (!force && this.statusCache && Date.now() - this.statusCache.at < 2000) return {...this.statusCache.value, ownership:this.ownership.getOwnership(), connectAudioStalled:!!this.ownership.external?.audioStalled, connectHistory:!!this.ownership.connectHistory, rateLimited:!!this.statusCache.value.rateLimited || (Date.now()<this.blockedUntil && /rate limit/.test(this.blockedMessage))};
        const settingsUrl = new URL('/plugins/SpotOn/settings/basic.html', this.base);
        settingsUrl.searchParams.set('playerid', this.playerId);
        let result = { state: 'not-connected', connected: false, account: '', settingsUrl: settingsUrl.href,
            authUrl: settingsUrl.href + '#spoton-pkce-auth', canDisconnect: false };
        try {
            const health = await (await this.request('/plugins/SpotOn/status/data')).json();
            const [profiles, active, selected, clientId] = await Promise.all([
                this.rpc(['pref', 'plugin.spoton:accounts', '?'], ''),
                this.rpc(['pref', 'plugin.spoton:activeAccount', '?'], ''),
                this.rpc(['playerpref', 'plugin.spoton:activeAccount', '?']),
                this.rpc(['pref', 'plugin.spoton:clientId', '?'], '')
            ]);
            const accounts = profiles._p2 || {};
            const id = selected._p2 || active._p2;
            const auth = health.authHealth?.[id];
            result.account = clean(accounts[id]?.displayName);
            result.hasAccount = !!accounts[id];
            result.clientIdMode = /^[a-f0-9]{32}$/i.test(clientId._p2 || '') ? 'personal' : 'shared';
            this.clientIdMode = result.clientIdMode;
            result.redirectUri = require('./spoton-settings').redirectUri;
            const daemon=health.daemons?.find(d=>String(d.mac).toLowerCase()===this.playerId.toLowerCase());
            result.connectAvailable=!!(daemon?.alive && daemon.connectEnabled);
            result.sessionHealthy=daemon?.sessionHealth?.session_valid == null ? null : Number(daemon.sessionHealth.session_valid) === 1;
            result.version = clean(health.system?.pluginVersion);
            if (Number(auth?.pkce?.needsReauth) === 1) result.state = 'auth-expired';
            else if (Number(auth?.pkce?.hasToken) === 1) {
                result.state = 'connected'; result.connected = true;
            }
            result.playbackAuthorized = Number(auth?.playback?.hasCredentials) === 1 && Number(auth?.playback?.needsAuth) !== 1;
            result.playbackAuthUrl = settingsUrl.href + '#spoton-player-auth';
            result.rateLimited = Number(health.api?.rateLimited) === 1;
            this.api429Count = Number(health.api?.api429Count) || 0;
            if (!health.system?.pluginVersion) result.state = 'error';
        } catch (error) {
            result.state = error.code === 404 ? 'not-installed' : error instanceof SyntaxError ? 'error' : 'unavailable';
        }
        if(result.connected)this.accountsUnavailable=false;
        else if(result.state==='not-connected' && !result.hasAccount)this.accountsUnavailable=true;
        if (result.connected && this.getSettings().spotifySearchEnabled == null) this.setSetting('spotifySearchEnabled', true);
        result.ownership = this.ownership.getOwnership();
        result.connectAudioStalled = !!this.ownership.external?.audioStalled;
        result.connectHistory = !!this.ownership.connectHistory;
        result.rateLimited = !!result.rateLimited || (Date.now()<this.blockedUntil && /rate limit/.test(this.blockedMessage));
        result.includeSearch = result.connected && ![false, 'false'].includes(this.getSettings().spotifySearchEnabled);
        const identity = result.account + ':' + result.state;
        if (this.identity && this.identity !== identity) { this.cache.clear(); this.handles.clear(); }
        this.identity = identity;
        const diagnostics={state:result.state,connected:result.connected,authorized:!!result.playbackAuthorized,
            connectAvailable:!!result.connectAvailable,sessionHealthy:result.sessionHealthy ?? null,rateLimited:!!result.rateLimited};
        const signature=JSON.stringify(diagnostics);
        if(signature !== this.lastDiagnostics) {this.lastDiagnostics=signature;this.log('status',diagnostics);}
        this.statusCache = { at: Date.now(), value: result };
        return result;
    }

    rateLimitMessage() {
        return this.clientIdMode === 'personal' ? 'Spotify API rate limit reached. Try again later.'
            : 'Spotify search is temporarily rate limited. Set up personal Spotify search in Settings, or try again later.';
    }

    async ready(search = false) {
        const status = await this.status();
        if (!status.connected) throw new Error(status.state === 'auth-expired' ? 'Spotify needs to reconnect' : 'Spotify is not connected');
        if (search && !status.includeSearch) throw new Error('Spotify search is disabled');
        if (status.rateLimited) throw new Error(this.rateLimitMessage());
        if (Date.now() < this.blockedUntil) throw new Error(this.blockedMessage);
        return status;
    }

    items(params = {}, index = 0, count = 50, menu = true) {
        const tags = Object.entries(params).filter(([key]) => ['item_id', 'search'].includes(key)).map(([key, value]) => key + ':' + value);
        return this.rpc(['spoton', 'items', String(index), String(count), ...(menu ? ['menu:1'] : []), 'want_url:1', ...tags]);
    }

    params(item) {
        const action = item.actions?.go;
        // Never forward plugin play/add/like actions. Navigation is read-only items only.
        if (action && (action.cmd || []).join(' ') !== 'spoton items') return null;
        const id = action?.params?.item_id || item.params?.item_id;
        return typeof id === 'string' ? { item_id: id } : null;
    }

    remember(item, params) {
        if (!params) return item;
        if (this.handles.size >= 2000) this.handles.delete(this.handles.keys().next().value);
        const key = randomUUID();
        this.handles.set(key, { item, params, at: Date.now() });
        return { ...item, key };
    }

    normalize(raw, hint = 'folder', parent = {}) {
        const uri = clean(raw.presetParams?.favorites_url || raw.url);
        const parts = clean(raw.text || raw.title || raw.name).split('\n');
        const subtitle = parts.slice(1).join(' ');
        const details = subtitle.split(' • ');
        const kind = /^(?:spoton:\/\/|spotify:(?:\/\/)?)track:/.test(uri) ? 'track' : /album:/.test(uri) ? 'album' : /playlist:/.test(uri) ? 'playlist' : hint;
        const item = { kind, uri: /^(?:spoton:\/\/|spotify:)(?:track|album|playlist):[A-Za-z0-9]{22}$/.test(uri) ? uri : '',
            title: clean(raw.title) || parts[0] || '', subtitle, artist: clean(raw.artist) || (kind === 'track' ? details[0] || parent.artist || '' : kind === 'album' ? subtitle.replace(/\s+\(\d{4}[^)]*\)$/, '') : ''),
            album: clean(raw.album) || (kind === 'track' ? details.slice(1).join(' • ') || (parent.kind === 'album' ? parent.title : '') : ''),
            artwork: media.artwork(raw.presetParams?.icon, raw.icon, raw['icon-id'], raw.image, parent.artwork),
            ...(kind === 'playlist' ? {owner:subtitle} : {}),
            year: kind === 'album' ? (subtitle.match(/\((\d{4})[^)]*\)$/) || [])[1] || '' : '' };
        if (kind === 'track' && media.trackURI.test(uri)) {
            item.song = media.song({ songfile: uri, parentUri:parent.uri, albumart: item.artwork, tags: { common: { title: item.title, artist: item.artist, album: item.album }, format: { duration: raw.duration } } });
            return item;
        }
        return this.remember(item, this.params(raw));
    }

    async search(keyword) {
        keyword = clean(keyword).trim().slice(0, 200);
        const empty = { tracks: [], albums: [], artists: [], playlists: [] };
        if (keyword.length < 2) return empty;
        try {
            await this.ready(true);
            const old = this.cache.get(keyword);
            if (old && Date.now() - old.at < 30000) return await old.value;
            const value = this.searchUncached(keyword, this.api429Count);
            if (this.cache.size >= 30) this.cache.delete(this.cache.keys().next().value);
            this.cache.set(keyword, { at: Date.now(), value });
            return await value;
        } catch (error) {
            this.cache.delete(keyword);
            return { ...empty, message: /reconnect|disabled|rate limit|not connected|SpotOn search/.test(error.message) ? error.message : 'Spotify search is temporarily unavailable' };
        }
    }

    async searchUncached(keyword, initial429Count = this.api429Count) {
        try {
            const types = await this.searchTypes(keyword);
            const result = { tracks: [], albums: [], artists: [], playlists: [] };
            // The icon identifies the category without depending on translated labels.
            await Promise.all(['track', 'album', 'artist', 'playlist'].map(async kind => {
                const category = (types.item_loop || []).find(i => new RegExp('/' + ({ track: 'song', album: 'album', artist: 'artist', playlist: 'playlist' })[kind] + '\.png$').test(i.icon || i['icon-id'] || ''));
                if (!category) return;
                const feed = await this.items(this.params(category), 0, 8);
                result[kind + 's'] = (feed.item_loop || []).map(i => this.normalize(i, kind)).filter(i => kind === 'track' ? i.song : i.key);
            }));
            return result;
        } catch (error) {
            // SpotOn may retry Spotify internally beyond our HTTP timeout. Its
            // transient rateLimited flag can clear before Randy reads it, so
            // compare the cumulative counter as well. Never inspect token stores.
            let rateLimited = false;
            try {
                const health = await (await this.request('/plugins/SpotOn/status/data')).json();
                rateLimited = Number(health.api?.rateLimited) === 1 || Number(health.api?.api429Count) > initial429Count;
            } catch { /* LMS itself may be unavailable. */ }
            this.blockedMessage = rateLimited
                ? this.rateLimitMessage()
                : 'LMS/SpotOn search is unavailable or did not respond. Local search is still available';
            this.blockedUntil = Date.now() + (rateLimited ? 60000 : 30000);
            throw new Error(this.blockedMessage);
        }
    }

    async searchTypes(keyword) {
        const root = await this.items();
        const search = (root.item_loop || []).find(i => /\/search\.png$/.test(i.icon || i['icon-id'] || ''));
        if (!search) throw new Error('SpotOn search unavailable');
        const page = await this.items(this.params(search));
        const input = (page.item_loop || []).find(i => i.type === 'search');
        if (!input) throw new Error('SpotOn search unavailable');
        return this.items({ ...this.params(input), search: keyword });
    }

    async resolveContainer(handle) {
        const item = handle.item;
        if (!['album', 'playlist', 'artist'].includes(item.kind)) return true;
        // XMLBrowser re-fetches coderef parents with quantity=1. Spotify search
        // rankings can differ with limit/offset, so broad positional paths are
        // unsafe. Resolve an exact search's FIRST item, verify its stable URI,
        // and use that same single-item query when XMLBrowser descends again.
        const quote = text => '"' + text.replace(/["\\]/g, ' ') + '"';
        const title = item.title;
        const query = item.kind === 'album' ? 'album:' + quote(title) + (item.artist ? ' artist:' + quote(item.artist) : '')
            : item.kind === 'artist' ? 'artist:' + quote(item.title) : item.title;
        const types = await this.searchTypes(query);
        const icon = {album:'album',playlist:'playlist',artist:'artist'}[item.kind];
        const category = (types.item_loop || []).find(i => new RegExp('/' + icon + '\\.png$').test(i.icon || i['icon-id'] || ''));
        if (!category) return item.kind === 'playlist' ? this.resolveLibraryPlaylist(handle) : false;
        const first = (await this.items(this.params(category), 0, 1)).item_loop?.[0];
        if (!first) return item.kind === 'playlist' ? this.resolveLibraryPlaylist(handle) : false;
        const candidate = this.normalize(first, item.kind);
        if (item.uri ? candidate.uri !== item.uri : candidate.title !== item.title)
            return item.kind === 'playlist' ? this.resolveLibraryPlaylist(handle) : false;
        handle.params = this.params(first);
        return !!handle.params;
    }

    async resolveLibraryPlaylist(handle) {
        // Owned/collaborative playlists can remain accessible when public
        // playlist contents are forbidden. Library ordering is not search rank.
        const root = await this.items();
        const library = (root.item_loop || []).find(i=>/\/musicfolder\.png$/.test(i.icon || ''));
        if (!library) return false;
        const categories = await this.items(this.params(library));
        const playlists = (categories.item_loop || []).find(i=>/\/playlist(?:s)?\.png$/.test(i.icon || ''));
        if (!playlists) return false;
        for (let offset=0;offset<2000;offset+=100) {
            const feed = await this.items(this.params(playlists),offset,100);
            const entries = feed.item_loop || [];
            const selected = entries.find(i=>i.presetParams?.favorites_url===handle.item.uri);
            if (selected) {handle.params=this.params(selected);return !!handle.params;}
            if (!entries.length || offset+100>=Number(feed.count)) break;
        }
        return false;
    }

    albumBookmark(key) {
        const handle = this.handles.get(key);
        if (!handle || Date.now() - handle.at > 30 * 60000) throw new Error('Spotify results expired; search again');
        if (handle.item.kind !== 'album') throw new Error('A Spotify album is required');
        return media.album(handle.item);
    }

    async browseAlbum(bookmark) {
        await this.ready();
        const saved = media.album(bookmark);
        const item = this.remember({kind:'album', uri:saved.songfile, title:saved.title, artist:saved.artist, artwork:saved.albumart}, {});
        return this.browse(item.key, true);
    }

    async browse(key, all = false) {
        await this.ready();
        const handle = this.handles.get(key);
        if (!handle || Date.now() - handle.at > 30 * 60000) throw new Error('Spotify results expired; search again');
        const limited = message => ({...handle.item, items:[], total:0, hasMore:false, enumerable:false, message});
        if (!await this.resolveContainer(handle)) return limited("Randy couldn't open this one. Try it in Spotify.");
        const items = [];
        let total = 0, offset = 0;
        do {
            const feed = await this.items(handle.params, offset, 100);
            const raw = feed.item_loop || [];
            total = Number(feed.count) || raw.length;
            for (const entry of raw) {
                const icon = entry.icon || entry['icon-id'] || '';
                const hint = /\/album\.png$/.test(icon) ? 'folder' : handle.item.kind === 'artist' ? 'folder' : 'album';
                let item = this.normalize(entry, hint, handle.item);
                if (handle.item.kind === 'album' && item.song && entry.params?.item_id) {
                    // Leaf queries expose title/artist/album/duration which the
                    // compact menu omits. Validate URI before accepting metadata.
                    const detail = await this.items({item_id:entry.params.item_id}, 0, 1, false);
                    const leaf = detail.loop_loop?.[0];
                    if (leaf) {
                        if (leaf.url !== item.uri) throw new Error('Spotify browse changed; search again');
                        item = this.normalize(leaf, 'track', handle.item);
                    }
                }
                if (item.song || item.key) items.push(item);
            }
            offset += 100;
            if (offset >= 2000 && offset < total && all) throw new Error('Spotify collection is too large (maximum 2000 entries); queue individual tracks');
            if (!raw.length) break;
        } while (all && offset < total);
        const enumerable = items.some(i=>i.song) && offset >= total;
        return { ...handle.item, items, total, hasMore: offset < total, enumerable,
            ...(!items.length ? {message:'SpotOn did not expose tracks for this collection. It may be empty or restricted by Spotify Development Mode; Randy cannot import it.'} : {}) };
    }

    setClientId(value) { return require('./spoton-settings').setClientId(this, value); }

    async image(value, size = 640) {
        const source = media.imageSource(value);
        if (!source) throw new Error('Invalid Spotify artwork');
        size = Number(size);
        if (![300,640].includes(size)) throw new Error('Invalid artwork size');
        const response = await this.request('/imageproxy/' + encodeURIComponent(source) + '/image_' + size + 'x' + size + '_o');
        if (!(response.headers.get('content-type') || '').startsWith('image/')) throw new Error('Artwork unavailable');
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 5 * 1024 * 1024) throw new Error('Artwork too large');
        return { bytes, type: response.headers.get('content-type') };
    }
}

module.exports = options => new Spotify(options);
