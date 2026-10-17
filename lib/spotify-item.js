'use strict';

const trackURI = /^(?:spoton:\/\/|spotify:(?:\/\/)?)track:[A-Za-z0-9]{22}$/;
const containerURI = /^(?:spoton:\/\/|spotify:)(?:album|playlist):[A-Za-z0-9]{22}$/;
const string = value => typeof value === 'string' ? value.slice(0, 2000) : '';

function imageSource(value) {
    try {
        if (!value) return null;
        if (value.startsWith('/spotify/artwork?')) value = new URL(value, 'http://randy').searchParams.get('url');
        else if (value.startsWith('/imageproxy/')) value = decodeURIComponent(value.split('/')[2]);
        const url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
        if (!['scdn.co', 'spotifycdn.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))) return null;
        // Spotify artwork is public. Never forward query strings or authorization material.
        return url.origin + url.pathname;
    } catch { return null; }
}

function artwork(...values) {
    for (const value of values) {
        const source = imageSource(value);
        if (source) return '/spotify/artwork?url=' + encodeURIComponent(source);
    }
    return '/IMG/Record.png';
}

function isSong(song) {
    return !!song && typeof song === 'object' && song.type === 'spotify' && trackURI.test(song.songfile);
}

function song(item) {
    if (!item || !trackURI.test(item.songfile || '')) throw new Error('An individual Spotify track is required');
    const common = item.tags?.common || {};
    const duration = Number(item.tags?.format?.duration);
    return { type: 'spotify', source: 'spotify', songfile: item.songfile,
        ...(containerURI.test(item.parentUri || '') ? {parentUri:item.parentUri} : {}),
        albumart: artwork(item.albumart),
        tags: { common: { title: string(common.title) || 'Spotify track', artist: string(common.artist), album: string(common.album) },
            format: { ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}) } } };
}

module.exports = { trackURI, containerURI, isSong, song, artwork, imageSource };
