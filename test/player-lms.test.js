'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const createPlayer = require('../lib/player');

function fixture(t, options = {}) {
    const calls = [], errors = [], ended = [], connections = [];
    let raw = { player_connected: '1', mode: 'stop', time: '0', duration: '10',
        can_seek: '1', 'mixer volume': '50', playlist_loop: [{ url: 'file:///music/A.wav' }] };
    let handler;
    const player = createPlayer({ backend: 'lms', playerId: 'test-player', pollInterval: 60000, ...options }, {
        fetch: async (url, options) => {
            assert.equal(url, 'http://127.0.0.1:9000/jsonrpc.js');
            const body = JSON.parse(options.body);
            assert.equal(body.method, 'slim.request');
            const command = body.params[1];
            assert.equal(body.params[0], command[0] === 'players' ? '' : 'test-player');
            calls.push(command);
            if (handler) return handler(command);
            if (command[0] === 'play') raw.mode = 'play';
            if (command[0] === 'pause') raw.mode = 'pause';
            if (command[0] === 'stop') raw.mode = 'stop';
            if (command[0] === 'time') raw.time = command[1];
            if (command[0] === 'mixer') raw['mixer volume'] = command[2];
            if (command[0] === 'playlist' && command[1] === 'play') {
                raw.playlist_loop = [{ url: /^spotify:/.test(command[2]) ? command[2].replace(/^spotify:(?:\/\/)?/, 'spotify://') : /^(?:https?:|spoton:)/.test(command[2]) ? command[2] : 'file://' + command[2] }]; raw.time = '0';
            }
            return { ok: true, json: async () => ({ result: command[0] === 'players' ? { count: raw.player_connected == null ? 0 : 1, players_loop: raw.player_connected == null ? [] : [{ playerid: 'test-player', connected: raw.player_connected }] } : command[0] === 'status' ? { ...raw } : {} }) };
        }
    });
    player.on('playback-error', event => errors.push(event));
    player.on('ended', event => ended.push(event));
    player.on('connection-change', event => connections.push(event));
    t.after(() => player.close());
    return { player, calls, errors, ended, connections, raw,
        handler: value => { handler = value; },
        load: (id = 1, file = '/music/A.wav') => player.loadAndPlay({ songfile: file }, { playbackId: id }) };
}

for (const [name, file, metadata, expected] of [
    ['FLAC local file', '/music/test.flac', { type: 'flc', samplerate: '96000', samplesize: '24', channels: '2', bitrate: '2840kbps VBR' }, 'FLAC 96kHz 24bit 2840kbps'],
    ['MP3 local file', '/music/test.mp3', { type: 'mp3', samplerate: 44100, channels: 2, bitrate: '320kbps CBR' }, 'MP3 44.1kHz 320kbps'],
    ['AAC local file', '/music/test.m4a', { type: 'aac', samplerate: 48000, channels: 2, bitrate: '256kbps' }, 'AAC 48kHz 256kbps'],
    ['radio with complete metadata', 'https://radio.example/live', { type: 'mp3', samplerate: 44100, samplesize: 16, channels: 2, bitrate: '128kbps' }, 'MP3 44.1kHz 16bit 128kbps'],
    ['radio without sample rate', 'https://radio.example/live', { type: 'aac', channels: '2', bitrate: '64kbps' }, 'AAC 64kbps'],
    ['missing/invalid technical metadata', 'https://radio.example/live', { samplerate: 'unknown', samplesize: 0, channels: -1, bitrate: 'unknown' }, ''],
    ['plugin source metadata with explicit bitrate units', 'https://radio.example/live', { type: 'ogg', samplerate: 48000, bitrate: '0.32Mbps' }, 'OGG 48kHz 320kbps']
]) test('audio stats: ' + name, async t => {
    const f = fixture(t); await f.load(1, file);
    Object.assign(f.raw.playlist_loop[0], metadata); await f.player._poll();
    assert.equal((await f.player.getStatus()).audioStats, expected);
    assert.ok(f.calls.some(command => command[3] === 'tags:uNoTIHraldK'));
});

test('audio stats publish bitrate changes during playback without reloading the track', async t => {
    const f = fixture(t); await f.load();
    const updates = [];
    f.player.on('status', status => {
        if (status.changed.includes('audioStats')) updates.push(status.audioStats);
    });
    Object.assign(f.raw.playlist_loop[0], { type: 'flc', samplerate: 44100, channels: 2, bitrate: '543kbps VBR' });
    await f.player._poll();
    f.raw.playlist_loop[0].bitrate = '615kbps VBR';
    await f.player._poll(); await f.player._poll();
    assert.deepEqual(updates, ['FLAC 44.1kHz 543kbps', 'FLAC 44.1kHz 615kbps']);
    assert.equal(f.calls.filter(command => command[0] === 'playlist' && command[1] === 'play').length, 1);
});

test('audio stats clear on replacement and reject stale track and in-flight metadata', async t => {
    const f = fixture(t); await f.load();
    Object.assign(f.raw.playlist_loop[0], { type: 'flc', samplerate: 96000 });
    await f.player._poll(); assert.equal((await f.player.getStatus()).audioStats, 'FLAC 96kHz');
    let reply;
    const old = { ...f.raw, playlist_loop: [{ url: 'file:///music/A.wav', type: 'mp3', samplerate: 44100 }] };
    f.handler(() => new Promise(resolve => { reply = resolve; }));
    const pending = f.player._poll(); f.handler(null);
    await f.load(2, '/music/B.wav');
    assert.equal((await f.player.getStatus()).audioStats, '');
    reply({ ok: true, json: async () => ({ result: old }) }); await pending;
    f.raw.playlist_loop = old.playlist_loop; await f.player._poll();
    assert.equal((await f.player.getStatus()).audioStats, '');
    f.raw.playlist_loop = [{ url: 'file:///music/B.wav', type: 'aac' }]; await f.player._poll();
    assert.equal((await f.player.getStatus()).audioStats, 'AAC');
    delete f.raw.playlist_loop[0].type; await f.player._poll();
    assert.equal((await f.player.getStatus()).audioStats, '');
});

test('connect finds configured player and normalizes numeric strings', async t => {
    const f = fixture(t); await f.player.connect(); await f.load();
    assert.deepEqual(await f.player.getStatus(), { playbackId: 1, connected: true, state: 'playing', connectionState: 'connected',
        position: 0, duration: 10, seekable: true, volume: 50, audioStats: '' });
    assert.deepEqual(f.connections.map(e => e.state), ['connected']);
});

for (const presence of [undefined, '0']) test('connect waits for absent/disconnected player: ' + presence, async t => {
    const f = fixture(t); f.raw.player_connected = presence;
    await f.player.connect();
    assert.equal(f.errors.length, 0); assert.equal((await f.player.getStatus()).connectionState, 'waiting-for-player');
    await f.load();
    assert.equal(f.calls.some(command => command[0] === 'playlist'), false);
});

test('load sends exactly one local file, disables repeat/shuffle and ensures play', async t => {
    const f = fixture(t); await f.player.connect(); await f.load();
    assert.deepEqual(f.calls.filter(command => !['status', 'players'].includes(command[0])), [
        ['playlist', 'shuffle', '0'], ['playlist', 'repeat', '0'], ['playlist', 'play', '/music/A.wav'], ['play']]);
    await assert.rejects(f.load(2, 'ftp://example.org/audio'), /absolute local/);
});

for (const [method, args, command, field, expected] of [
    ['pause', [], ['pause', '1'], 'state', 'paused'],
    ['play', [], ['play'], 'state', 'playing'],
    ['seek', [4], ['time', '4'], 'position', 4],
    ['setVolume', [37], ['mixer', 'volume', '37'], 'volume', 37],
    ['stop', [], ['stop'], 'state', 'stopped']
]) test(method + ' maps to LMS command', async t => {
    const f = fixture(t); await f.load(); await f.player[method](...args);
    assert.ok(f.calls.some(call => JSON.stringify(call) === JSON.stringify(command)));
    assert.equal((await f.player.getStatus())[field], expected);
    assert.equal(f.ended.length, 0);
});

test('initial idle and stopped statuses never complete an unplayed file', async t => {
    const f = fixture(t); await f.player.connect(); await f.player._poll();
    await f.load(); f.raw.mode = 'stop'; await f.player._poll();
    assert.equal(f.ended.length, 0);
});

test('manual stop near the end does not emit ended, including late status', async t => {
    const f = fixture(t); await f.load(); f.raw.time = '9.95'; await f.player._poll();
    await f.player.stop(); await f.player._poll(); assert.equal(f.ended.length, 0);
});

test('replacement rejects old remote file status and never completes old playback', async t => {
    const f = fixture(t); await f.load(); f.raw.time = '9.95'; await f.player._poll();
    await f.load(2, '/music/B.wav');
    f.raw.playlist_loop = [{ url: 'file:///music/A.wav' }]; f.raw.mode = 'stop';
    await f.player._poll(); assert.equal(f.ended.length, 0);
    assert.equal((await f.player.getStatus()).playbackId, 2);
    assert.equal((await f.player.getStatus()).state, 'playing');
});

test('in-flight status from previous playbackId is rejected even for the same file', async t => {
    const f = fixture(t); await f.load();
    let reply; f.handler(() => new Promise(resolve => { reply = resolve; }));
    const pending = f.player._poll(); f.handler(null);
    await f.load(2); reply({ ok: true, json: async () => ({ result: { ...f.raw, mode: 'stop', time: '10' } }) });
    await pending; assert.equal(f.ended.length, 0);
    assert.equal((await f.player.getStatus()).playbackId, 2);
    assert.equal((await f.player.getStatus()).state, 'playing');
});

test('natural completion emits ended once after observed playing near duration', async t => {
    const f = fixture(t); await f.load(); f.raw.time = '9.95'; await f.player._poll();
    f.raw.mode = 'stop'; f.raw.time = '0'; await f.player._poll(); await f.player._poll();
    assert.deepEqual(f.ended, [{ playbackId: 1 }]);
});

test('pause at the end does not complete', async t => {
    const f = fixture(t); await f.load(); f.raw.time = '9.95'; await f.player._poll();
    await f.player.pause(); f.raw.mode = 'stop'; await f.player._poll(); assert.equal(f.ended.length, 0);
});

for (const kind of ['jsonrpc', 'http', 'network']) test(kind + ' failure reports disconnect and recovers without false completion', async t => {
    const f = fixture(t); await f.load(); f.raw.time = '9.95'; await f.player._poll();
    f.handler(async () => {
        if (kind === 'network') throw new Error('connection refused');
        return { ok: kind !== 'http', status: 503, json: async () => ({ error: { message: 'unavailable' } }) };
    });
    await f.player._poll(); await f.player._poll();
    assert.equal(f.errors.length, 0); assert.equal((await f.player.getStatus()).connected, false);
    assert.equal(f.connections.at(-1).state, 'lms-unavailable');
    f.handler(null); f.raw.mode = 'stop'; await f.player._poll();
    assert.equal((await f.player.getStatus()).connected, true); assert.equal(f.ended.length, 0);
    f.raw.mode = 'play'; f.raw.time = '9.95'; await f.player._poll(); f.raw.mode = 'stop'; await f.player._poll();
    assert.equal(f.ended.length, 1);
});

test('close releases polling and does not stop external Squeezelite', async t => {
    const f = fixture(t); await f.player.connect(); await f.player.close();
    assert.equal(f.calls.some(command => command[0] === 'stop'), false);
    assert.equal((await f.player.getStatus()).connected, false);
});

test('stop during load acknowledgement cannot resume the stopped track', async t => {
    const f = fixture(t); let acknowledge, started;
    const loading = new Promise(resolve => { started = resolve; });
    f.handler(async command => {
        if (command[0] === 'playlist' && command[1] === 'play') {
            started(); return new Promise(resolve => { acknowledge = resolve; });
        }
        return { ok: true, json: async () => ({ result: command[0] === 'players' ? { players_loop: [{ playerid: 'test-player', connected: 1 }] } : command[0] === 'status' ? f.raw : {} }) };
    });
    const load = f.load(); await loading;
    const stop = f.player.stop(); acknowledge({ ok: true, json: async () => ({ result: {} }) });
    await load; await stop;
    assert.equal(f.calls.some(command => command[0] === 'play'), false);
    assert.equal(f.ended.length, 0);
});

test('replacement during a delayed load cannot play the old track', async t => {
    const f = fixture(t); let acknowledge, started;
    const loading = new Promise(resolve => { started = resolve; });
    f.handler(async command => {
        if (command[0] === 'playlist' && command[1] === 'play') {
            started(); return new Promise(resolve => { acknowledge = resolve; });
        }
        return { ok: true, json: async () => ({ result: command[0] === 'players' ? { players_loop: [{ playerid: 'test-player', connected: 1 }] } : command[0] === 'status' ? f.raw : {} }) };
    });
    const old = f.load(); await loading; f.handler(null);
    const replacement = f.load(2, '/music/B.wav');
    acknowledge({ ok: true, json: async () => ({ result: {} }) }); await old; await replacement;
    assert.equal(f.calls.filter(command => command[0] === 'play').length, 1);
    assert.equal((await f.player.getStatus()).playbackId, 2);
});

test('scheduled polling recovers from unavailable player', async t => {
    const f = fixture(t, { retryInitial: 5 }); f.player.pollInterval = 5; f.raw.player_connected = '0';
    await f.player.connect(); f.raw.player_connected = '1';
    const deadline = Date.now() + 1000;
    while (!(await f.player.getStatus()).connected && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal((await f.player.getStatus()).connected, true);
});

test('command transport failure reports connection state and permits later recovery', async t => {
    const f = fixture(t); await f.load();
    f.handler(async () => { throw new Error('connection refused'); });
    await f.player.pause(); assert.equal(f.errors.length, 0);
    assert.match(f.connections.at(-1).error.message, /LMS.*test-player.*connection refused/);
    f.handler(null); await f.player.play(); await f.player._poll(); assert.equal((await f.player.getStatus()).connected, true);
});

test('missing LMS player configuration is rejected and unknown backend is rejected', async t => {
    const player = createPlayer({ backend: 'lms' }); t.after(() => player.close());
    await assert.rejects(player.connect(), /LMS_PLAYER_ID/);
    assert.throws(() => createPlayer({ backend: 'unknown' }), /Unknown playback backend/);
});

test('out-of-order status for the same playback cannot overwrite a newer observation', async t => {
    const f = fixture(t); await f.load(); let reply;
    f.handler(() => new Promise(resolve => { reply = resolve; }));
    const stale = f.player._poll(); f.handler(null); f.raw.time = '3'; await f.player._poll();
    reply({ ok: true, json: async () => ({ result: { ...f.raw, mode: 'stop', time: '10' } }) });
    await stale; assert.equal((await f.player.getStatus()).position, 3); assert.equal(f.ended.length, 0);
});

test('stale request error cannot disconnect a replacement playback', async t => {
    const f = fixture(t); await f.load(); let fail;
    f.handler(() => new Promise((resolve, reject) => { fail = reject; }));
    const pending = f.player._poll(); f.handler(null); await f.load(2);
    fail(new Error('old failure')); await pending;
    assert.equal(f.errors.length, 0); assert.equal((await f.player.getStatus()).connected, true);
});

test('configured URL and timeout abort are honored', async t => {
    let address;
    const player = createPlayer({ backend: 'lms', playerId: 'test', serverUrl: 'http://example.test:9001', requestTimeout: 5 }, {
        fetch: (url, options) => {
            address = url;
            return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('timeout'))));
        }
    });
    t.after(() => player.close()); await player.connect(); assert.equal((await player.getStatus()).connectionState, 'lms-unavailable');
    assert.equal(address, 'http://example.test:9001/jsonrpc.js');
});

test('close suppresses late responses and completion', async t => {
    const f = fixture(t); await f.load(); let reply;
    f.handler(() => new Promise(resolve => { reply = resolve; }));
    const pending = f.player._poll(); await f.player.close();
    reply({ ok: true, json: async () => ({ result: { ...f.raw, mode: 'play' } }) }); await pending;
    assert.equal((await f.player.getStatus()).connected, false); assert.equal(f.ended.length, 0);
});

test('slow file load/start acknowledgements use a longer deadline than status polling', async t => {
    const f = fixture(t); f.player.timeout = 5;
    f.handler(async command => {
        if (command[0] === 'play' || command[1] === 'play') {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        return { ok: true, json: async () => ({ result: command[0] === 'players' ? { players_loop: [{ playerid: 'test-player', connected: 1 }] } : command[0] === 'status' ? { ...f.raw, mode: 'play' } : {} }) };
    });
    // Check the actual AbortSignal too: a mocked fetch must honor aborts to catch regressions.
    const originalFetch = f.player.fetch;
    f.player.fetch = (url, options) => Promise.race([
        originalFetch(url, options),
        new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    ]);
    await f.load();
    assert.equal(f.errors.length, 0); assert.equal((await f.player.getStatus()).state, 'playing');
});

for (const url of ['http://radio.example/live.mp3', 'https://radio.example/live.aac']) {
    test('direct radio URL is the only LMS queue item: ' + url, async t => {
        const f = fixture(t); await f.load(1, url);
        assert.deepEqual(f.calls.filter(c => !['status', 'players'].includes(c[0])), [
            ['playlist', 'shuffle', '0'], ['playlist', 'repeat', '0'], ['playlist', 'play', url], ['play']]);
        assert.equal((await f.player.getStatus()).duration, null);
        assert.equal((await f.player.getStatus()).seekable, false);
    });
}

test('radio forwards native live title/station name, clears absent metadata and does not synthesize titles', async t => {
    const f = fixture(t); await f.load(1, 'https://radio.example/live');
    f.raw.current_title = 'Artist - Track'; f.raw.playlist_loop[0].remote_title = 'Native station';
    f.raw.time = '2.5'; await f.player._poll();
    assert.deepEqual((await f.player.getStatus()).radioMetadata, { title: 'Artist - Track', stationName: 'Native station' });
    assert.equal((await f.player.getStatus()).position, 2.5);
    const events = []; f.player.on('status', s => events.push(s));
    await f.player._poll(); assert.equal(events.length, 0);
    f.raw.current_title = 'Native station'; await f.player._poll();
    assert.equal((await f.player.getStatus()).radioMetadata.title, '');
    f.raw.current_title = 'https://radio.example/live'; await f.player._poll();
    assert.equal((await f.player.getStatus()).radioMetadata.title, '');
    f.raw.playlist_loop[0].remote_title = 'https://radio.example/live'; await f.player._poll();
    assert.equal((await f.player.getStatus()).radioMetadata.stationName, '');
    delete f.raw.current_title; delete f.raw.playlist_loop[0].remote_title; await f.player._poll();
    assert.deepEqual((await f.player.getStatus()).radioMetadata, { title: '', stationName: '' });
    await f.load(2); assert.equal((await f.player.getStatus()).radioMetadata, null);
});

test('healthy live stream and programme duration/title changes never emit EOF', async t => {
    const f = fixture(t); await f.load(1, 'https://radio.example/live');
    f.raw.time = '9.99'; await f.player._poll();
    f.raw.time = '0'; f.raw.duration = '0.01'; f.raw.current_title = 'Next programme'; await f.player._poll();
    f.player.current.startAt = 0; await f.player._poll();
    assert.equal(f.ended.length, 0); assert.equal(f.errors.length, 0);
    f.raw.mode = 'stop'; await f.player._poll();
    assert.equal(f.ended.length, 0); // External stop is not a reliable live EOF signal.
});

test('buffering/initial idle are tolerated; failed stream startup reports and advances once without disconnecting', async t => {
    const f = fixture(t); await f.load(1, 'https://radio.example/dead');
    f.raw.mode = 'stop'; await f.player._poll(); assert.equal(f.errors.length, 0);
    f.raw.mode = 'play'; f.raw.waitingToPlay = '1'; f.raw.time = '2';
    await f.player._poll(); assert.equal(f.player.current.started, false);
    f.player.current.startAt = 0; await f.player._poll(); await f.player._poll();
    assert.match(f.errors[0].error.message, /stream did not start.*https:\/\/radio.example\/dead/);
    assert.deepEqual(f.ended, [{ playbackId: 1, reason: 'error' }]);
    assert.equal((await f.player.getStatus()).connected, true);
});

test('pause during startup and manual stop cannot produce a delayed stream failure/EOF', async t => {
    const f = fixture(t); await f.load(1, 'https://radio.example/live');
    await f.player.pause(); f.player.current.startAt = 0; await f.player._poll();
    assert.equal(f.errors.length, 0); assert.equal(f.ended.length, 0);
    await f.player.play(); assert.equal(f.player.current.paused, false);
    await f.player.stop(); f.player.current.startAt = 0; await f.player._poll();
    assert.equal(f.errors.length, 0); assert.equal(f.ended.length, 0);
});

test('radio replacement rejects old station metadata/status and delayed failure', async t => {
    const f = fixture(t); await f.load(1, 'https://radio.example/old');
    let reply; f.handler(() => new Promise(resolve => { reply = resolve; }));
    const pending = f.player._poll(); f.handler(null);
    await f.load(2, 'https://radio.example/new');
    f.player.current.startAt = 0;
    const old = { ...f.raw, mode: 'stop', current_title: 'Old artist - Old title',
        playlist_loop: [{ url: 'https://radio.example/old', remote_title: 'Old station' }] };
    reply({ ok: true, json: async () => ({ result: old }) }); await pending;
    f.raw.playlist_loop = old.playlist_loop; await f.player._poll();
    assert.equal(f.errors.length, 0); assert.equal(f.ended.length, 0);
    assert.equal((await f.player.getStatus()).radioMetadata.title, '');
    assert.equal((await f.player.getStatus()).playbackId, 2);
});

test('radio startup failure can recover with a replacement and ignores outage time', async t => {
    const f = fixture(t); await f.load(1, 'https://radio.example/live');
    f.player.current.startAt = 0;
    f.handler(async () => { throw new Error('network down'); }); await f.player._poll();
    assert.equal(f.ended.length, 0);
    f.handler(null); await f.player._poll(); assert.equal(f.ended.length, 0);
    f.player.current.startAt = 0; await f.player._poll(); assert.equal(f.ended.length, 1);
    await f.load(2, 'https://radio.example/recovered'); f.raw.time = '1'; await f.player._poll();
    assert.equal((await f.player.getStatus()).state, 'playing');
    assert.equal((await f.player.getStatus()).playbackId, 2);
    assert.equal(f.ended.length, 1);
});

test('stream error listener replacement cannot trigger completion for the newer selection', async t => {
    const f = fixture(t); await f.load(1, 'https://radio.example/dead');
    let replacement;
    f.player.on('playback-error', () => { replacement = f.load(2, 'https://radio.example/good'); });
    f.player.current.startAt = 0; await f.player._poll(); await replacement;
    assert.equal(f.ended.length, 0); assert.equal((await f.player.getStatus()).playbackId, 2);
});

test('native LMS pause while radio is buffering suspends the startup deadline', async t => {
    const f = fixture(t); await f.load(1, 'https://radio.example/live');
    f.player.current.startAt = 0; f.raw.mode = 'pause'; await f.player._poll();
    assert.equal(f.errors.length, 0); assert.equal(f.ended.length, 0);
    f.raw.mode = 'play'; await f.player._poll(); assert.equal(f.ended.length, 0);
});

test('play cannot re-emit a stream failure completion for the same playbackId', async t => {
    const f = fixture(t); await f.load(1, 'https://radio.example/dead');
    f.player.current.startAt = 0; await f.player._poll();
    await f.player.play(); f.player.current.startAt = 0; await f.player._poll();
    assert.equal(f.ended.length, 1); assert.equal(f.errors.length, 1);
    await f.load(2, 'https://radio.example/good'); f.raw.time = '1'; await f.player._poll();
    assert.equal((await f.player.getStatus()).position, 1);
});

for (const alreadyPlaying of [false, true]) test('volume survives ' + (alreadyPlaying ? 'track replacement' : 'initial load'), async t => {
    const f = fixture(t); if (alreadyPlaying) await f.load();
    const volume = f.player.setVolume(35);
    const loading = f.load(2, '/music/B.wav');
    await Promise.all([volume, loading]);
    assert.ok(f.calls.some(c => c[0] === 'mixer' && c[2] === '35'));
    assert.equal((await f.player.getStatus()).volume, 35);
    assert.equal((await f.player.getStatus()).playbackId, 2);
    assert.equal(f.errors.length, 0); assert.equal(f.ended.length, 0);
});

const flush = () => new Promise(resolve => setImmediate(resolve));

test('LMS down at startup is connection state, not media failure; pending load retries once', async t => {
    const f = fixture(t);
    f.handler(async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); });
    await f.player.connect(); await f.load(); await f.load(2, '/music/B.wav');
    assert.equal((await f.player.getStatus()).connectionState, 'lms-unavailable');
    assert.equal(f.errors.length, 0); assert.equal(f.ended.length, 0);
    assert.equal(f.calls.length, 1); // Offline selections do not bypass connection backoff.
    assert.match(f.connections.at(-1).error.message, /ECONNREFUSED/);
    f.handler(null); await f.player._poll(); await f.player._poll();
    assert.deepEqual(f.calls.filter(c => c[0] === 'playlist' && c[1] === 'play'), [['playlist', 'play', '/music/B.wav']]);
    assert.equal((await f.player.getStatus()).playbackId, 2);
    assert.equal((await f.player.getStatus()).state, 'playing');
});

test('player discovery avoids querying an absent player and retries when it connects', async t => {
    const f = fixture(t); delete f.raw.player_connected;
    await f.load(); await f.player._poll();
    assert.ok(f.calls.every(c => c[0] === 'players'));
    assert.equal((await f.player.getStatus()).connectionState, 'waiting-for-player');
    f.raw.player_connected = '1'; await f.player._poll();
    assert.equal((await f.player.getStatus()).connected, true);
    assert.equal((await f.player.getStatus()).state, 'playing');
    assert.equal(f.errors.length, 0); assert.equal(f.ended.length, 0);
});

test('manual stop cancels a pending offline load, including its later reconnect', async t => {
    const f = fixture(t); f.raw.player_connected = '0'; await f.load();
    await f.player.stop(); f.raw.player_connected = '1'; await f.player._poll(); await f.player._poll();
    assert.equal(f.calls.some(c => c[0] === 'playlist'), false);
    assert.equal((await f.player.getStatus()).state, 'stopped');
    assert.equal(f.errors.length, 0); assert.equal(f.ended.length, 0);
});

test('stale reconnect discovery cannot restore a replaced playback request', async t => {
    const f = fixture(t); f.raw.player_connected = '0'; await f.load();
    let reply; f.handler(() => new Promise(resolve => { reply = resolve; }));
    const pending = f.player._poll(); await f.load(2, '/music/B.wav'); f.handler(null);
    reply({ ok: true, json: async () => ({ result: { players_loop: [{ playerid: 'test-player', connected: 1 }] } }) });
    await pending; assert.equal((await f.player.getStatus()).connected, false);
    f.raw.player_connected = '1'; await f.player._poll();
    assert.deepEqual(f.calls.filter(c => c[0] === 'playlist' && c[1] === 'play'), [['playlist', 'play', '/music/B.wav']]);
    assert.equal(f.ended.length, 0);
});

test('local file resumes the same playbackId and position after LMS outage', async t => {
    const f = fixture(t); await f.load(); f.raw.time = '4.25'; await f.player._poll();
    f.handler(async () => { throw new Error('connection refused'); }); await f.player._poll();
    assert.equal(f.player.current.pending, true); assert.equal(f.errors.length, 0);
    const before = f.calls.length; f.handler(null); f.raw.mode = 'stop'; f.raw.time = '0';
    await f.player._poll();
    assert.ok(f.calls.slice(before).some(c => c[0] === 'time' && c[1] === '4.25'));
    assert.equal((await f.player.getStatus()).playbackId, 1);
    assert.equal((await f.player.getStatus()).position, 4.25);
    assert.equal((await f.player.getStatus()).state, 'playing');
    assert.equal(f.ended.length, 0);
});

test('paused local file stays paused through reconnect', async t => {
    const f = fixture(t); await f.load(); f.raw.time = '3'; await f.player.pause();
    f.raw.player_connected = '0'; await f.player._poll();
    const before = f.calls.length; f.raw.player_connected = '1'; await f.player._poll();
    assert.equal((await f.player.getStatus()).state, 'paused');
    assert.equal((await f.player.getStatus()).position, 3);
    assert.equal(f.calls.slice(before).some(c => c[0] === 'play'), false);
    assert.equal(f.ended.length, 0);
});

test('pause and seek requested while offline are honored on reconnect', async t => {
    const f = fixture(t); await f.load(); f.raw.player_connected = '0'; await f.player._poll();
    await f.player.pause(); await f.player.seek(6);
    f.raw.player_connected = '1'; await f.player._poll();
    assert.equal((await f.player.getStatus()).state, 'paused');
    assert.equal((await f.player.getStatus()).position, 6);
    assert.equal(f.errors.length, 0); assert.equal(f.ended.length, 0);
});

test('Squeezelite reconnect restores local file without advancing', async t => {
    const f = fixture(t); await f.load(); f.raw.time = '5'; await f.player._poll();
    f.raw.player_connected = '0'; await f.player._poll(); await f.player._poll();
    assert.equal((await f.player.getStatus()).connectionState, 'waiting-for-player');
    f.raw.player_connected = '1'; f.raw.mode = 'stop'; await f.player._poll();
    assert.equal((await f.player.getStatus()).position, 5);
    assert.equal((await f.player.getStatus()).state, 'playing');
    assert.equal(f.errors.length, 0); assert.equal(f.ended.length, 0);
});

test('radio restarts after outage without seeking, stale EOF or media errors', async t => {
    const f = fixture(t); await f.load(1, 'https://radio.example/live');
    f.raw.time = '100'; await f.player._poll();
    f.handler(async () => { throw new Error('network down'); }); await f.player._poll();
    const before = f.calls.length; f.handler(null); await f.player._poll();
    assert.ok(f.calls.slice(before).some(c => c[0] === 'playlist' && c[1] === 'play'));
    assert.equal(f.calls.slice(before).some(c => c[0] === 'time'), false);
    assert.equal((await f.player.getStatus()).position, 0);
    f.raw.time = '1'; await f.player._poll();
    assert.equal(f.player.current.started, true);
    assert.equal(f.ended.length, 0); assert.equal(f.errors.length, 0);
});

test('radio startup deadline never expires while waiting for Squeezelite', async t => {
    const f = fixture(t); f.raw.player_connected = '0'; await f.load(1, 'https://radio.example/live');
    f.player.current.startAt = 0; await f.player._poll(); await f.player._poll();
    assert.equal(f.errors.length, 0); assert.equal(f.ended.length, 0);
    f.raw.player_connected = '1'; await f.player._poll(); f.raw.time = '1'; await f.player._poll();
    assert.equal(f.player.current.started, true); assert.equal(f.ended.length, 0);
});

test('volume survives an outage and only the newest offline volume is restored', async t => {
    const f = fixture(t); await f.load(); await f.player.setVolume(35);
    f.raw.player_connected = '0'; await f.player._poll();
    await f.player.setVolume(37); await f.player.setVolume(42);
    const before = f.calls.length; f.raw.player_connected = '1'; f.raw['mixer volume'] = '75'; await f.player._poll();
    assert.deepEqual(f.calls.slice(before).filter(c => c[0] === 'mixer'), [['mixer', 'volume', '42']]);
    assert.equal((await f.player.getStatus()).volume, 42);
});

test('outage after EOF cannot reload or complete an already ended playbackId', async t => {
    const f = fixture(t); await f.load(); f.raw.time = '9.95'; await f.player._poll();
    f.raw.mode = 'stop'; await f.player._poll(); assert.equal(f.ended.length, 1);
    f.raw.player_connected = '0'; await f.player._poll();
    f.raw.player_connected = '1'; await f.player._poll(); await f.player._poll();
    assert.equal(f.calls.filter(c => c[0] === 'playlist' && c[1] === 'play').length, 1);
    assert.equal(f.ended.length, 1); assert.equal(f.errors.length, 0);
});

test('repeated infrastructure failures emit one connection transition and no playback errors', async t => {
    const f = fixture(t); await f.load();
    f.handler(async () => { throw new TypeError('fetch failed'); });
    for (let i = 0; i < 8; i++) await f.player._poll();
    assert.equal(f.connections.filter(e => e.state === 'lms-unavailable').length, 1);
    assert.equal(f.errors.length, 0); assert.equal(f.ended.length, 0);
});

test('reconnection uses bounded exponential backoff and resets after success', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture(t, { pollInterval: 250 });
    f.handler(async () => { throw new TypeError('fetch failed'); }); await f.player.connect();
    for (const delay of [1000, 2000, 4000, 8000, 12000, 12000]) {
        const before = f.calls.length;
        t.mock.timers.tick(delay - 1); await flush(); assert.equal(f.calls.length, before);
        t.mock.timers.tick(1); await flush(); assert.equal(f.calls.length, before + 1);
    }
    f.handler(null); t.mock.timers.tick(12000); await flush();
    assert.equal((await f.player.getStatus()).connected, true); assert.equal(f.player.retryDelay, 1000);
    f.handler(async () => { throw new Error('connection refused again'); });
    t.mock.timers.tick(250); await flush(); const before = f.calls.length;
    t.mock.timers.tick(999); await flush(); assert.equal(f.calls.length, before);
    t.mock.timers.tick(1); await flush(); assert.equal(f.calls.length, before + 1);
    assert.equal(f.errors.length, 0); assert.equal(f.ended.length, 0);
});

test('close cancels offline retries and pending playback', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture(t); f.raw.player_connected = '0'; await f.load();
    await f.player.close(); const before = f.calls.length;
    t.mock.timers.tick(120000); await flush();
    assert.equal(f.calls.length, before); assert.equal(f.ended.length, 0);
});

test('RPC command rejection during player restart stays pending instead of becoming a media error', async t => {
    const f = fixture(t); await f.player.connect();
    f.handler(async c => ({ ok: true, json: async () => c[0] === 'playlist' && c[1] === 'play' ?
        { error: { code: -32000, message: 'player not found' } } : { result: {} } }));
    await f.load(); assert.equal(f.player.current.pending, true);
    assert.equal(f.errors.length, 0); assert.equal(f.ended.length, 0);
    f.handler(null); await f.player._poll();
    assert.equal((await f.player.getStatus()).state, 'playing');
    assert.equal(f.player.current.pending, false);
});

test('near-EOF outage restores before the end instead of synthesizing an immediate completion', async t => {
    const f = fixture(t); await f.load(); f.raw.time = '9.99'; await f.player._poll();
    f.raw.player_connected = '0'; await f.player._poll();
    f.raw.mode = 'stop'; f.raw.time = '0'; f.raw.player_connected = '1'; await f.player._poll();
    assert.equal(f.ended.length, 0); assert.equal((await f.player.getStatus()).position, 9.25);
    f.raw.time = '9.99'; await f.player._poll(); f.raw.mode = 'stop'; await f.player._poll();
    assert.equal(f.ended.length, 1);
});

test('a working status endpoint does not busy-loop when load commands keep failing', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture(t, { pollInterval: 250 }); await f.player.connect();
    const transport = f.player.fetch;
    f.player.fetch = async (url, options) => {
        const c = JSON.parse(options.body).params[1];
        if (c[0] === 'playlist' && c[1] === 'play') throw new TypeError('fetch failed');
        return transport(url, options);
    };
    await f.load();
    for (const delay of [1000, 2000, 4000, 8000, 12000]) {
        const before = f.calls.length;
        t.mock.timers.tick(delay - 1); await flush(); assert.equal(f.calls.length, before);
        t.mock.timers.tick(1); await flush(); assert.ok(f.calls.length > before);
        assert.equal((await f.player.getStatus()).connected, false);
    }
    assert.equal(f.errors.length, 0); assert.equal(f.ended.length, 0);
});

test('play after a manual stop while LMS is down becomes a current pending request', async t => {
    const f = fixture(t); await f.load(); await f.player.stop();
    f.raw.player_connected = '0'; await f.player._poll();
    await f.player.play(); f.raw.player_connected = '1'; await f.player._poll();
    assert.equal((await f.player.getStatus()).state, 'playing');
    assert.equal((await f.player.getStatus()).position, 0);
    assert.equal(f.ended.length, 0); assert.equal(f.errors.length, 0);
});

const spotifyA = 'spotify:track:6UCFZ9ZOFRxK8oak7MdPZu';
const spotifyB = 'spotify:track:3M0zi8iD2KRzY71XcGFUpE';

test('Spotify loads only one track and accepts the canonical LMS status URI', async t => {
    const f = fixture(t); await f.load(1, spotifyA);
    assert.equal((await f.player.getStatus()).state, 'playing');
    assert.equal((await f.player.getStatus()).seekable, true);
    assert.equal((await f.player.getStatus()).duration, 10);
    assert.deepEqual(f.calls.filter(c => c[0] === 'playlist'), [
        ['playlist', 'shuffle', '0'], ['playlist', 'repeat', '0'], ['playlist', 'play', spotifyA]]);
    await f.load(2, spotifyB.replace('spotify:', 'spotify://'));
    assert.equal((await f.player.getStatus()).playbackId, 2);
    assert.equal((await f.player.getStatus()).state, 'playing');
});

for (const uri of ['spotify:album:2WNI378JH55k63eXBHbjbI', 'spotify:playlist:6RQNh4WKdhsn8hcihVDMsM',
    'spotify:artist:3WrFJ7ztbogyGnTHbHJFl2', 'spotify:track:bad', 'spotify:track:6UCFZ9ZOFRxK8oak7MdPZu?token=bad']) {
    test('rejects non-track or malformed Spotify URI: ' + uri, async t => {
        const f = fixture(t); await assert.rejects(f.load(1, uri), /individual Spotify\/SpotOn track/);
        assert.equal(f.calls.length, 0);
    });
}

test('Spotify source quality is not inferred from SpotOn transport or configured bitrate', async t => {
    const f = fixture(t); await f.load(1, spotifyA);
    Object.assign(f.raw.playlist_loop[0], { title: 'Her Majesty', artist: 'The Beatles', album: 'Abbey Road',
        artwork_url: '/imageproxy/art/image.png', type: 'ogg', samplerate: '44100', samplesize: '16', bitrate: '320k VBR' });
    await f.player._poll(); const s = await f.player.getStatus();
    assert.deepEqual(s.trackMetadata, { title: 'Her Majesty', artist: 'The Beatles', album: 'Abbey Road', artwork: '/imageproxy/art/image.png' });
    assert.equal(s.audioStats, 'Spotify');
    await f.load(2, '/music/A.wav');
    assert.equal((await f.player.getStatus()).trackMetadata, null);
});

for (const type of ['PCM, SpotOn Connect', 'FLAC, SpotOn Browse', 'OGG, SpotOn Browse']) {
    test('SpotOn relay details are not presented as Spotify source quality: ' + type, async t => {
        const f = fixture(t); await f.load(1, spotifyA);
        Object.assign(f.raw.playlist_loop[0], {type, samplerate:'44100', samplesize:'16', bitrate:'320k'});
        await f.player._poll();
        assert.equal((await f.player.getStatus()).audioStats, 'Spotify');
    });
}

test('Spotify rejects stale URI and in-flight metadata after track replacement', async t => {
    const f = fixture(t); await f.load(1, spotifyA);
    const old = { ...f.raw, playlist_loop: [{ url: spotifyA.replace('spotify:', 'spotify://'), title: 'Old', type: 'ogg' }] };
    let reply; f.handler(() => new Promise(resolve => { reply = resolve; }));
    const pending = f.player._poll(); f.handler(null); await f.load(2, spotifyB);
    reply({ ok: true, json: async () => ({ result: old }) }); await pending;
    f.raw.playlist_loop = old.playlist_loop; await f.player._poll();
    assert.notEqual((await f.player.getStatus()).trackMetadata?.title, 'Old');
    assert.equal(f.ended.length, 0);
});

test('Spotify controls and EOF reuse finite-track behavior and complete once', async t => {
    const f = fixture(t); await f.load(1, spotifyA);
    await f.player.pause(); assert.equal((await f.player.getStatus()).state, 'paused');
    await f.player.seek(4); assert.equal((await f.player.getStatus()).position, 4);
    await f.player.play(); await f.player.setVolume(35);
    f.raw.time = '9.95'; await f.player._poll(); f.raw.mode = 'stop'; f.raw.duration = undefined;
    await f.player._poll(); f.raw.duration = '10'; await f.player._poll();
    assert.deepEqual(f.ended, [{ playbackId: 1 }]);
    await f.load(2, spotifyB); f.raw.time = '9.95'; await f.player._poll();
    await f.player.stop(); await f.player._poll();
    assert.equal(f.ended.length, 1);
});

test('Spotify request recovers after infrastructure outage at its saved position without ending', async t => {
    const f = fixture(t); await f.load(1, spotifyA);
    f.raw.time = '4'; await f.player._poll();
    f.handler(() => { throw new TypeError('fetch failed'); }); await f.player._poll();
    assert.equal((await f.player.getStatus()).connectionState, 'lms-unavailable');
    f.handler(null); await f.player._poll();
    assert.equal((await f.player.getStatus()).state, 'playing');
    assert.ok(f.calls.some(c => c[0] === 'time' && c[1] === '4'));
    assert.equal(f.ended.length, 0); assert.equal(f.errors.length, 0);
});

for (const [name, source, target] of [
    ['Spotify to Spotify','spoton://track:3M0zi8iD2KRzY71XcGFUpE','spoton://track:6UCFZ9ZOFRxK8oak7MdPZu'],
    ['Spotify to local','spoton://track:3M0zi8iD2KRzY71XcGFUpE','/music/A.wav'],
    ['local to Spotify','/music/A.wav','spoton://track:3M0zi8iD2KRzY71XcGFUpE'],
    ['Spotify to radio','spoton://track:3M0zi8iD2KRzY71XcGFUpE','https://radio.example/live'],
    ['radio to Spotify','https://radio.example/live','spoton://track:3M0zi8iD2KRzY71XcGFUpE']
]) test('SpotOn source transition: ' + name, async t => {
    const f = fixture(t); await f.load(1, source);
    f.raw.time = '2'; await f.player._poll();
    await f.load(2, target);
    assert.equal((await f.player.getStatus()).playbackId, 2);
    assert.equal(f.calls.filter(c => c[0] === 'playlist' && c[1] === 'play').length, 2);
    assert.equal(f.calls.findLast(c => c[0] === 'playlist' && c[1] === 'play')[2], target);
    assert.equal(f.ended.length, 0); assert.equal(f.errors.length, 0);
});
test('SpotOn unavailable track reports once and never advances the queue', async t => {
    const f = fixture(t, {streamStartTimeout: 10}); await f.load(1, 'spoton://track:3M0zi8iD2KRzY71XcGFUpE');
    f.raw.mode = 'stop'; f.player.current.startAt = Date.now() - 50;
    await f.player._poll(); await f.player._poll();
    assert.equal(f.errors.length, 1); assert.equal(f.ended.length, 0);
    assert.match(f.errors[0].error.message, /Spotify needs to reconnect/);
    await f.player.play(); assert.equal(f.player.current.ended, false);
    assert.equal(f.calls.filter(c=>c[0]==='playlist'&&c[1]==='play').length,2);
});
test('SpotOn natural completion emits once, and stale artwork cannot replace current metadata', async t => {
    const f = fixture(t); const a = 'spoton://track:3M0zi8iD2KRzY71XcGFUpE';
    await f.load(1,a); f.raw.time='9.99'; f.raw.playlist_loop[0].artwork_url='https://i.scdn.co/image/A';
    await f.player._poll(); f.raw.mode='stop';await f.player._poll();await f.player._poll();assert.equal(f.ended.length,1);
    await f.load(2,'spoton://track:6UCFZ9ZOFRxK8oak7MdPZu');
    f.raw.playlist_loop=[{url:a,artwork_url:'https://i.scdn.co/image/A'}];await f.player._poll();
    assert.equal((await f.player.getStatus()).trackMetadata.artwork,'');
});

test('SpotOn load while LMS is down recovers only the latest selected track', async t => {
    const f=fixture(t);f.handler(async()=>{throw new TypeError('fetch failed');});
    await f.load(1,'spoton://track:3M0zi8iD2KRzY71XcGFUpE');
    await f.load(2,'spoton://track:6UCFZ9ZOFRxK8oak7MdPZu');
    assert.equal(f.ended.length,0);assert.equal(f.errors.length,0);
    f.handler(null);await f.player._poll();
    const loads=f.calls.filter(c=>c[0]==='playlist'&&c[1]==='play');
    assert.equal(loads.length,1);assert.equal(loads[0][2],'spoton://track:6UCFZ9ZOFRxK8oak7MdPZu');
    assert.equal(f.ended.length,0);assert.equal(f.errors.length,0);
});
