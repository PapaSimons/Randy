'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const createPlayer = require('../lib/player');

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

class FakeMPV extends EventEmitter {
    constructor() {
        super();
        this.calls = [];
        this.entry = 0;
        this.properties = { 'audio-out-params': { samplerate: 44100, 'channel-count': 2 }, 'file-format': 'mp3' };
    }
    command(...args) { this.calls.push(args); return Promise.resolve(); }
    setProperty(...args) { this.calls.push(['setProperty', ...args]); return Promise.resolve(); }
    getProperty(name) { this.calls.push(['getProperty', name]); return Promise.resolve(this.properties[name]); }
    seek(...args) { this.calls.push(['seek', ...args]); return Promise.resolve(); }
    stop() { this.calls.push(['stop']); return Promise.resolve(); }
    onIdle(callback) { this.on('idle', callback); }
    loadfile(...args) {
        this.calls.push(['loadfile', ...args]);
        this.emit('start-file', { playlist_entry_id: ++this.entry });
        return Promise.resolve();
    }
    observer(name) {
        return this.calls.filter(call => call[0] === 'observe_property' && call[2] === name).at(-1)[1];
    }
    property(name, data, id = this.observer(name)) {
        this.emit('property-change', { name, data, id });
    }
    end(reason = 'eof', entry = this.entry) {
        this.emit('end-file', { reason, playlist_entry_id: entry });
        this.emit('idle');
    }
}

async function fixture(t, options = {}) {
    const client = new FakeMPV();
    const lifecycle = { kills: 0, closes: 0, args: null };
    const player = createPlayer(options, {
        killMPV: () => lifecycle.kills++,
        createTransport: (config, callback) => {
            lifecycle.args = config.args;
            queueMicrotask(() => callback(null, client));
            return { close: () => lifecycle.closes++ };
        }
    });
    t.after(() => player.close());
    const statuses = [], ended = [], errors = [], connections = [];
    player.on('status', value => statuses.push(value));
    player.on('ended', value => ended.push(value));
    player.on('playback-error', value => errors.push(value));
    player.on('connection-change', value => connections.push(value));
    await player.connect();
    return { player, client, lifecycle, statuses, ended, errors, connections };
}

const song = { songfile: '/music/a.flac' };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('MPV arguments retain yt-dlp, disabled ReplayGain, device selection and Linux ALSA', async t => {
    const mac = await fixture(t, { platform: 'darwin', audioOutputDevice: 'coreaudio/device' });
    assert.deepEqual(mac.lifecycle.args, [
        '--no-config', '--af-clr', '--vf-clr', '--vid=no', '--no-video',
        'script-opts=ytdl_hook-ytdl_path=yt-dlp', '--audio-display=no',
        '--no-initial-audio-sync', '--audio-format=float', '--audio-fallback-to-null=yes',
        '--audio-device=coreaudio/device', '--replaygain=no', '--ytdl-format=bestaudio'
    ]);
    const linux = await fixture(t, { platform: 'linux' });
    assert.deepEqual(linux.lifecycle.args.slice(-4), [
        '--alsa-resample=yes', '--ao=alsa', '--volume=100', '--volume-max=100'
    ]);
    assert.equal(linux.lifecycle.kills, 1);
    await linux.player.connect();
    assert.equal(linux.lifecycle.kills, 1);
});

test('replacement loads original songfile and unpauses; controls preserve MPV commands', async t => {
    const { player, client } = await fixture(t);
    await player.loadAndPlay(song, { playbackId: 1 });
    await player.pause();
    await player.play();
    await player.seek(42);
    await player.setVolume(37);
    assert.deepEqual(client.calls.filter(call => ['loadfile', 'setProperty', 'seek'].includes(call[0])), [
        ['loadfile', song.songfile, 'replace'], ['setProperty', 'pause', false],
        ['setProperty', 'pause', true], ['setProperty', 'pause', false],
        ['seek', 42, 'absolute'], ['setProperty', 'volume', 37]
    ]);
    await player.loadAndPlay({ songfile: 'https://example.com/page' }, { playbackId: 2 });
    assert.ok(client.calls.some(call => call[0] === 'loadfile' && call[1] === 'https://example.com/page'));
});

test('status preserves position, seekability, duration, live metadata, devices and audio-stat format', async t => {
    const { player, client, statuses } = await fixture(t);
    await player.loadAndPlay(song, { playbackId: 4 });
    client.property('audio-pts', 12.5);
    client.property('seekable', false);
    client.property('duration', 123);
    client.property('volume', 55);
    client.property('pause', true);
    client.property('media-title', 'Original title');
    client.property('metadata', { 'icy-title': 'Live title', 'icy-name': 'Station' });
    client.property('audio-device-list', [{ name: 'auto', description: 'Autoselect' }]);
    client.property('ao', 'coreaudio');
    client.property('audio-bitrate', 128000);
    await flush();
    const status = await player.getStatus();
    assert.equal(status.playbackId, 4);
    assert.equal(status.position, 12.5);
    assert.equal(status.duration, 123);
    assert.equal(status.seekable, false);
    assert.equal(status.volume, 55);
    assert.equal(status.state, 'paused');
    assert.equal(status.mpv.metadata['icy-title'], 'Live title');
    assert.equal(status.mpv.mediaTitle, 'Original title');
    assert.equal(status.mpv.audioOutput, 'coreaudio');
    assert.equal(status.mpv.audioDevices[0].name, 'auto');
    assert.equal(status.mpv.audioStats, 'MP3,  44.1khz,  2ch,  128kbs');
    assert.ok(statuses.some(value => value.changed.includes('position')));
});

test('old property subscription IDs cannot update a replacement track', async t => {
    const { player, client, statuses } = await fixture(t);
    await player.loadAndPlay(song, { playbackId: 1 });
    const oldTitle = client.observer('media-title');
    const oldPosition = client.observer('audio-pts');
    await player.loadAndPlay({ songfile: '/music/b.flac' }, { playbackId: 2 });
    const count = statuses.length;
    client.property('media-title', 'Stale title', oldTitle);
    client.property('audio-pts', 999, oldPosition);
    assert.equal(statuses.length, count);
    assert.equal((await player.getStatus()).mpv.mediaTitle, null);
    client.property('audio-pts', 2);
    assert.equal(statuses.at(-1).playbackId, 2);
});

test('late audio-stat replies and errors from an older track are discarded', async t => {
    const { player, client, statuses, errors } = await fixture(t);
    const reply = deferred();
    client.getProperty = () => reply.promise;
    await player.loadAndPlay(song, { playbackId: 1 });
    client.property('audio-bitrate', 128000);
    await player.loadAndPlay(song, { playbackId: 2 });
    reply.resolve({ samplerate: 48000, 'channel-count': 2 });
    await flush();
    assert.equal(statuses.filter(value => value.changed.includes('audioStats')).length, 0);
    const failure = deferred();
    client.getProperty = () => failure.promise;
    client.property('audio-bitrate', 128000);
    await player.loadAndPlay(song, { playbackId: 3 });
    failure.reject(new Error('Old IPC failure'));
    await flush();
    assert.equal(errors.length, 0);
});

test('late load acknowledgement never unpauses the old selection', async t => {
    const { player, client } = await fixture(t);
    const first = deferred();
    const normalLoad = client.loadfile.bind(client);
    client.loadfile = (...args) => { normalLoad(...args); return first.promise; };
    const oldLoad = player.loadAndPlay(song, { playbackId: 1 });
    await flush();
    client.loadfile = normalLoad;
    const newLoad = player.loadAndPlay({ songfile: '/music/b.flac' }, { playbackId: 2 });
    first.resolve();
    await Promise.all([oldLoad, newLoad]);
    assert.equal(client.calls.filter(call => call[0] === 'setProperty' && call[1] === 'pause').length, 1);
    assert.equal((await player.getStatus()).playbackId, 2);
});

test('delayed start-file events retain the identity of their load commands', async t => {
    const { player, client, statuses } = await fixture(t);
    client.loadfile = () => Promise.resolve();
    await player.loadAndPlay(song, { playbackId: 1 });
    await player.loadAndPlay(song, { playbackId: 2 });
    client.emit('start-file', { playlist_entry_id: 10 });
    assert.equal(client.calls.some(call => call[0] === 'observe_property' && call[2] === 'media-title'), false);
    client.emit('start-file', { playlist_entry_id: 11 });
    client.property('media-title', 'Second track');
    assert.equal(statuses.at(-1).playbackId, 2);
    assert.equal(statuses.at(-1).mpv.mediaTitle, 'Second track');
});

test('EOF and failed files advance once on idle, preserving Randy completion policy', async t => {
    const { player, client, ended } = await fixture(t);
    client.emit('idle');
    assert.deepEqual(ended, []);
    await player.loadAndPlay(song, { playbackId: 1 });
    client.emit('end-file', { playlist_entry_id: 1, reason: 'eof' });
    assert.equal(ended.length, 0);
    client.emit('idle');
    client.emit('idle');
    assert.deepEqual(ended, [{ playbackId: 1 }]);
    await player.loadAndPlay(song, { playbackId: 2 });
    client.end('error');
    assert.deepEqual(ended, [{ playbackId: 1 }, { playbackId: 2 }]);
});

test('replacement stop events, old EOF, and explicit stop never advance the new selection', async t => {
    const { player, client, ended } = await fixture(t);
    await player.loadAndPlay(song, { playbackId: 1 });
    await player.loadAndPlay(song, { playbackId: 2 });
    client.end('eof', 1);
    assert.equal(ended.length, 0);
    client.end('stop', 2);
    assert.equal(ended.length, 0);
    await player.loadAndPlay(song, { playbackId: 3 });
    await player.stop();
    client.end('eof', 3);
    assert.equal(ended.length, 0);
    assert.equal((await player.getStatus()).state, 'stopped');
});

test('redirected playlist URLs keep the same playback identity', async t => {
    const { player, client, ended } = await fixture(t);
    await player.loadAndPlay(song, { playbackId: 1 });
    client.end('redirect');
    assert.equal(ended.length, 0);
    client.emit('start-file', { playlist_entry_id: 2 });
    client.end('eof', 2);
    assert.deepEqual(ended, [{ playbackId: 1 }]);
});

test('stop during an in-flight load prevents its late acknowledgement from resuming playback', async t => {
    const { player, client, ended } = await fixture(t);
    const reply = deferred();
    const normalLoad = client.loadfile.bind(client);
    client.loadfile = (...args) => { normalLoad(...args); return reply.promise; };
    const load = player.loadAndPlay(song, { playbackId: 1 });
    await flush();
    await player.stop();
    reply.resolve();
    await load;
    client.end('eof');
    assert.equal(client.calls.some(call => call[0] === 'setProperty' && call[1] === 'pause'), false);
    assert.equal((await player.getStatus()).state, 'stopped');
    assert.equal(ended.length, 0);
});

test('load rejection reports an error but retains the existing unpause attempt', async t => {
    const { player, client, errors } = await fixture(t);
    client.loadfile = () => Promise.reject('loading failed');
    await player.loadAndPlay(song, { playbackId: 1 });
    assert.equal(errors[0].error.message, 'loading failed');
    assert.equal(errors[0].restart, false);
    assert.ok(client.calls.some(call => call[0] === 'setProperty' && call[1] === 'pause' && call[2] === false));
});

test('only the current loading watchdog requests recovery after three seconds', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { player, client, errors } = await fixture(t);
    client.loadfile = () => new Promise(() => {});
    player.loadAndPlay(song, { playbackId: 1 });
    await flush();
    player.loadAndPlay(song, { playbackId: 2 });
    t.mock.timers.tick(3000);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].playbackId, 2);
    assert.equal(errors[0].restart, true);
});

test('closing releases transport, suppresses stale callbacks and reports disconnect', async t => {
    const { player, client, lifecycle, statuses, ended, connections } = await fixture(t);
    await player.loadAndPlay(song, { playbackId: 1 });
    await player.close();
    await player.close();
    const count = statuses.length;
    client.property('audio-pts', 100);
    client.end('eof');
    assert.equal(statuses.length, count);
    assert.equal(ended.length, 0);
    assert.equal(lifecycle.closes, 1);
    assert.equal(lifecycle.kills, 2);
    assert.deepEqual(connections.map(value => value.connected), [true, false]);
    await assert.rejects(player.connect(), /closed/);
});

test('closing during connection settles connect and cleans up the transport', async () => {
    let closed = false;
    const player = createPlayer({}, {
        killMPV: () => {},
        createTransport: () => ({ close: () => { closed = true; } })
    });
    const connecting = player.connect();
    await player.close();
    await assert.rejects(connecting, /closed while connecting/);
    assert.equal(closed, true);
});
