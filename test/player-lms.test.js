'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const createPlayer = require('../lib/player');

function fixture(t) {
    const calls = [], errors = [], ended = [], connections = [];
    let raw = { player_connected: '1', mode: 'stop', time: '0', duration: '10',
        can_seek: '1', 'mixer volume': '50', playlist_loop: [{ url: 'file:///music/A.wav' }] };
    let handler;
    const player = createPlayer({ backend: 'lms', playerId: 'test-player', pollInterval: 60000 }, {
        fetch: async (url, options) => {
            assert.equal(url, 'http://127.0.0.1:9000/jsonrpc.js');
            const body = JSON.parse(options.body);
            assert.equal(body.method, 'slim.request');
            assert.equal(body.params[0], 'test-player');
            const command = body.params[1];
            calls.push(command);
            if (handler) return handler(command);
            if (command[0] === 'play') raw.mode = 'play';
            if (command[0] === 'pause') raw.mode = 'pause';
            if (command[0] === 'stop') raw.mode = 'stop';
            if (command[0] === 'time') raw.time = command[1];
            if (command[0] === 'mixer') raw['mixer volume'] = command[2];
            if (command[0] === 'playlist' && command[1] === 'play') {
                raw.playlist_loop = [{ url: 'file://' + command[2] }]; raw.time = '0';
            }
            return { ok: true, json: async () => ({ result: command[0] === 'status' ? { ...raw } : {} }) };
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

test('connect finds configured player and normalizes numeric strings', async t => {
    const f = fixture(t); await f.player.connect(); await f.load();
    assert.deepEqual(await f.player.getStatus(), { playbackId: 1, connected: true, state: 'playing',
        position: 0, duration: 10, seekable: true, volume: 50 });
    assert.deepEqual(f.connections, [{ connected: true }]);
});

for (const presence of [undefined, '0']) test('connect rejects absent/disconnected player: ' + presence, async t => {
    const f = fixture(t); f.raw.player_connected = presence;
    await assert.rejects(f.player.connect(), /absent or disconnected/);
    assert.equal(f.errors.length, 1); assert.equal((await f.player.getStatus()).connected, false);
    await assert.rejects(f.load(), /absent or disconnected/);
    assert.equal(f.calls.some(command => command[0] === 'playlist'), false);
});

test('load sends exactly one local file, disables repeat/shuffle and ensures play', async t => {
    const f = fixture(t); await f.player.connect(); await f.load();
    assert.deepEqual(f.calls.filter(command => command[0] !== 'status'), [
        ['playlist', 'shuffle', '0'], ['playlist', 'repeat', '0'], ['playlist', 'play', '/music/A.wav'], ['play']]);
    await assert.rejects(f.load(2, 'https://example.org/audio'), /absolute local/);
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
    assert.equal(f.errors.length, 1); assert.equal((await f.player.getStatus()).connected, false);
    f.handler(null); f.raw.mode = 'stop'; await f.player._poll();
    assert.equal((await f.player.getStatus()).connected, true); assert.equal(f.ended.length, 0);
    f.raw.mode = 'play'; await f.player._poll(); f.raw.mode = 'stop'; await f.player._poll();
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
        return { ok: true, json: async () => ({ result: command[0] === 'status' ? f.raw : {} }) };
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
        return { ok: true, json: async () => ({ result: command[0] === 'status' ? f.raw : {} }) };
    });
    const old = f.load(); await loading; f.handler(null);
    const replacement = f.load(2, '/music/B.wav');
    acknowledge({ ok: true, json: async () => ({ result: {} }) }); await old; await replacement;
    assert.equal(f.calls.filter(command => command[0] === 'play').length, 1);
    assert.equal((await f.player.getStatus()).playbackId, 2);
});

test('scheduled polling recovers from failed connect', async t => {
    const f = fixture(t); f.player.pollInterval = 5; f.raw.player_connected = '0';
    await assert.rejects(f.player.connect()); f.raw.player_connected = '1';
    const deadline = Date.now() + 1000;
    while (!(await f.player.getStatus()).connected && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal((await f.player.getStatus()).connected, true);
});

test('command failure emits useful playback error and permits later recovery', async t => {
    const f = fixture(t); await f.load();
    f.handler(async () => { throw new Error('connection refused'); });
    await f.player.pause(); assert.equal(f.errors.length, 1);
    assert.match(f.errors[0].error.message, /LMS.*test-player.*connection refused/);
    f.handler(null); await f.player.play(); assert.equal((await f.player.getStatus()).connected, true);
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
    t.after(() => player.close()); await assert.rejects(player.connect(), /timeout/);
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
        return { ok: true, json: async () => ({ result: command[0] === 'status' ? { ...f.raw, mode: 'play' } : {} }) };
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
