'use strict';

const unsupportedMessage = "This URL isn't a direct audio stream. Randy currently supports direct web audio and radio stream URLs.";
const unsupported = () => Object.assign(new Error(unsupportedMessage), { code: 'DIRECT_AUDIO_REQUIRED' });

function validate(value) {
    let url;
    try {
        if (typeof value !== 'string' || value.length > 4096 || /[\s\u0000-\u001f]/.test(value)) throw unsupported();
        url = new URL(value);
    } catch { throw unsupported(); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw unsupported();
    return url;
}

function isWebpage(value) {
    let url;
    try { url = validate(value); } catch { return false; }
    return /(?:^|\.)(?:youtube\.com|youtube-nocookie\.com|youtu\.be|soundcloud\.com|vimeo\.com|mixcloud\.com)$/.test(url.hostname);
}

async function describe(value, { fetch = globalThis.fetch } = {}) {
    const url = validate(value);
    if (isWebpage(url.href)) throw unsupported();
    if (!/\.(?:mp3|aac|ogg|oga|opus|flac|wav|m4a|m3u8|m3u|pls)$/i.test(url.pathname)) {
        let response;
        try {
            response = await fetch(url.href, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(4000) });
            const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
            if (!response.ok || response.url && isWebpage(response.url) || !(/^audio\//.test(type) || ['application/ogg', 'application/vnd.apple.mpegurl', 'application/x-mpegurl'].includes(type))) throw unsupported();
        } catch { throw unsupported(); }
        finally { try { await response?.body?.cancel(); } catch {} }
    }
    return { songfile: url.href, type: 'stream', tags: { common: { title: url.href, artist: 'Audio Stream', album: '' } }, albumart: '' };
}

module.exports = { describe, validate, isWebpage, unsupported, unsupportedMessage };
