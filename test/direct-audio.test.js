'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const audio = require('../lib/direct-audio');

for (const suffix of ['mp3', 'aac', 'ogg', 'flac', 'm4a', 'm3u8', 'pls']) {
    test('direct ' + suffix + ' remains the original stream URL without a resolver', async () => {
        const url = 'https://radio.example/live.' + suffix + '?station=1';
        const song = await audio.describe(url, {fetch: () => { throw new Error('No classification fetch needed'); }});
        assert.equal(song.songfile, url);
        assert.equal(song.type, 'stream');
        assert.doesNotMatch(JSON.stringify(song), /sourceUrl|mediaUrl|token|extractor/);
    });
}
for (const type of ['audio/mpeg', 'audio/aac', 'application/ogg', 'audio/flac', 'application/vnd.apple.mpegurl', 'audio/x-mpegurl']) {
    test('extensionless radio is accepted by content type: ' + type, async () => {
        let cancelled = false;
        const song = await audio.describe('https://radio.example/live', {fetch: async () => ({ok:true, headers:new Headers({'Content-Type':type}), body:{cancel:async () => {cancelled = true;}}})});
        assert.equal(song.songfile, 'https://radio.example/live');
        assert.ok(cancelled, 'classification closes the stream without downloading it');
    });
}
for (const url of ['https://www.youtube.com/watch?v=test', 'https://youtu.be/test', 'https://soundcloud.com/artist/song', 'https://vimeo.com/123']) {
    test('media-service page rejected without networking: ' + url, async () => {
        await assert.rejects(audio.describe(url, {fetch: () => { assert.fail('Page must not be fetched'); }}), error => {
            assert.equal(error.message, audio.unsupportedMessage);
            assert.doesNotMatch(error.message, /LMS|yt-dlp|ffmpeg|stack/);
            return true;
        });
    });
}
test('arbitrary HTML page is rejected with the same safe message and its body is cancelled', async () => {
    let cancelled = false;
    await assert.rejects(audio.describe('https://example.com/page', {fetch: async () => ({ok:true, headers:new Headers({'content-type':'text/html'}), body:{cancel:async () => {cancelled = true;}}})}), {message:audio.unsupportedMessage});
    assert.ok(cancelled);
});
test('network errors and non-HTTP input have no technical error details', async () => {
    await assert.rejects(audio.describe('https://example.com/page', {fetch: async () => {throw new Error('SECRET upstream stack');}}), {message:audio.unsupportedMessage});
    for (const url of ['file:///etc/passwd', 'ftp://example.com/file.mp3', 'https://user:password@example.com/live.mp3']) await assert.rejects(audio.describe(url), {message:audio.unsupportedMessage});
});
test('runtime, installer and documentation contain no webpage resolver or relay', () => {
    const fs = require('node:fs'), path = require('node:path');
    for (const name of ['lib/web-media.js', 'lib/web-relay.js']) assert.equal(fs.existsSync(path.resolve(__dirname, '..', name)), false);
    for (const name of ['index.js', 'lib/direct-audio.js', 'lib/player/lms.js', 'lib/player/mpv.js', 'lib/playlist_utils.js', 'install.sh', 'README.md']) {
        const source = fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');
        assert.doesNotMatch(source, /yt-dlp|web-stream|web-relay|web-media|web-artwork/);
    }
});
