'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const flush = () => new Promise(resolve => setImmediate(resolve));

// Execute the actual server wiring without starting HTTP, MPV or persistent databases.
async function server(env = {}) {
    const sent = [], players = [], routes = new Map();
    const io = new EventEmitter();
    io.sockets = { emit: (name, data) => sent.push({ name, data }) };
    const songs = ['A', 'B'].map(title => ({
        songfile: '/music/' + title + '.flac', albumart: '/cover.jpg',
        tags: { common: { title, artist: 'Artist', album: 'Album' } }
    }));
    const settings = { musicfolders: null, audioOutputDevice: 'auto', playonstart: 'false' };
    const playlist = {
        index: 0, nextCalls: 0,
        getSettings: () => settings,
        setSetting: (key, value) => { settings[key] = value; },
        getPlayList: () => songs,
        getPlaying: () => playlist.index,
        getCurrentSong: () => songs[playlist.index],
        getVolume: () => 63,
        setVolume: value => { playlist.volume = value; },
        initPlaylist: () => Promise.resolve(songs[0]),
        nextsong: () => { playlist.nextCalls++; playlist.index = 1; return songs[1]; },
        prevsong: () => { playlist.index = 0; return songs[0]; },
        playsong: index => { playlist.index = index; return songs[index]; }
    };
    function createPlayer(options) {
        const player = new EventEmitter();
        player.options = options;
        player.calls = [];
        for (const name of ['connect', 'play', 'pause', 'stop', 'seek', 'setVolume', 'close']) {
            player[name] = (...args) => { player.calls.push([name, ...args]); return Promise.resolve(); };
        }
        player.loadAndPlay = (...args) => { player.calls.push(['loadAndPlay', ...args]); return Promise.resolve(); };
        players.push(player);
        return player;
    }
    const app = { use: () => {}, post: (name, handler) => routes.set(name, handler) };
    const express = () => app;
    express.static = () => {};
    const modules = {
        'console-stamp': () => {}, express,
        http: { Server: () => ({ listen: (port, callback) => callback() }) },
        'socket.io': () => io,
        'body-parser': { json: () => {}, urlencoded: () => {} },
        './lib/playlist_utils.js': playlist,
        './lib/player': createPlayer,
        metaget: {},
        child_process: { spawnSync: () => {} },
        fs: { existsSync: () => false },
        'node-disk-info': { getDiskInfo: () => Promise.resolve([]) },
        'node:os': { platform: () => 'darwin' }
    };
    const context = vm.createContext({
        require: name => {
            if (!(name in modules)) throw new Error('Unexpected server dependency: ' + name);
            return modules[name];
        },
        __dirname: path.join(__dirname, '..'),
        console: { log: () => {}, error: () => {} },
        process: { env, argv: [], platform: 'darwin', on: () => {} },
        setTimeout, clearTimeout
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8'), context);
    await flush();
    const socket = new EventEmitter();
    io.emit('connection', socket);
    return { context, socket, players, sent, playlist, routes, songs };
}

test('server routes controls through the common interface and keeps Randy selection', async () => {
    const { socket, players, playlist, songs, sent } = await server();
    const player = players[0];
    assert.equal(player.options.audioOutputDevice, 'auto');
    assert.equal(player.options.backend, 'mpv');
    assert.ok(player.calls.some(call => call[0] === 'setVolume' && call[1] === 63));
    assert.equal(player.calls.filter(call => call[0] === 'loadAndPlay').length, 0);
    socket.emit('play');
    socket.emit('pause');
    socket.emit('seek', 42);
    socket.emit('volume', '37');
    socket.emit('next');
    await flush();
    assert.equal(playlist.volume, 37);
    const load = player.calls.find(call => call[0] === 'loadAndPlay');
    assert.equal(load[1], songs[1]);
    assert.equal(load[2].playbackId, 1);
    assert.ok(player.calls.some(call => call[0] === 'seek' && call[1] === 42 && call.length === 2));
    assert.ok(sent.some(event => event.name === 'playlist' && event.data.playing === 1));
});

test('server preserves Socket.IO metadata, timing, volume and settings payloads', async () => {
    const { socket, players, sent, routes } = await server();
    socket.emit('playsong', 0);
    await flush();
    const status = {
        playbackId: 1, position: 12.5, duration: 200, seekable: true, volume: 37,
        mpv: {
            mediaTitle: 'MPV title', metadata: { 'icy-title': 'Live title', 'icy-name': 'Station' },
            audioStats: 'FLAC,  44.1khz,  2ch,  1000kbs',
            audioDevices: [{ name: 'auto', description: 'Autoselect device' }]
        },
        changed: ['position', 'duration', 'volume', 'mediaTitle', 'metadata', 'audioStats', 'audioDevices']
    };
    players[0].emit('status', status);
    const emitted = sent.slice(-6);
    assert.deepEqual(emitted.map(event => event.name), ['pos', 'duration', 'volume', 'nowplaying', 'nowplaying', 'audiostats']);
    assert.equal(emitted[0].data, 12.5);
    assert.equal(emitted[1].data, 200);
    assert.equal(emitted[3].data.title, 'A');
    assert.equal(emitted[3].data.albumart, '/cover.jpg');
    assert.equal(emitted[4].data.title, 'Live title');
    assert.equal(emitted[4].data.album, 'Station');
    const count = sent.length;
    players[0].emit('status', { ...status, seekable: false, changed: ['duration'] });
    assert.equal(sent.length, count);
    let response;
    await routes.get('/getSettings')({}, { header: () => {}, json: value => { response = value; } });
    assert.equal(response.audiodevices[0].name, 'auto');
    assert.equal(response.audiodevices[0].status, 'online');
});

test('server rejects stale status, completion, errors and load responses after replacement/restart', async () => {
    const { context, socket, players, sent, playlist } = await server();
    let finish;
    const old = players[0];
    old.loadAndPlay = () => new Promise(resolve => { finish = resolve; });
    socket.emit('playsong', 0);
    const oldId = context.playbackId;
    old.loadAndPlay = () => Promise.resolve();
    socket.emit('next');
    await flush();
    const count = sent.length;
    const nextCalls = playlist.nextCalls;
    old.emit('status', { playbackId: oldId, changed: ['position'], position: 999 });
    old.emit('ended', { playbackId: oldId });
    old.emit('playback-error', { playbackId: oldId, restart: true, error: new Error('Old error') });
    finish();
    await flush();
    assert.equal(sent.length, count);
    assert.equal(playlist.nextCalls, nextCalls);
    assert.equal(players.length, 1);
    context.restartplayer();
    await flush();
    assert.equal(players.length, 2);
    assert.ok(old.calls.some(call => call[0] === 'close'));
    const afterRestart = sent.length;
    old.emit('ended', { playbackId: context.playbackId });
    old.emit('status', { playbackId: context.playbackId, changed: ['position'], position: 999 });
    old.emit('playback-error', { playbackId: context.playbackId, restart: true, error: new Error('Old player error') });
    assert.equal(sent.length, afterRestart);
    assert.equal(players.length, 2);
});

test('server advances the Randy queue for current completion only', async () => {
    const { context, socket, players, playlist } = await server();
    socket.emit('playsong', 0);
    await flush();
    const id = context.playbackId;
    players[0].emit('ended', { playbackId: id });
    await flush();
    assert.equal(playlist.nextCalls, 1);
    assert.equal(context.playbackId, id + 1);
    players[0].emit('ended', { playbackId: id });
    assert.equal(playlist.nextCalls, 1);
});

test('LMS selection preserves frontend payloads and Randy queue ownership without MPV status', async () => {
    const { socket, context, players, sent, songs, routes, playlist } = await server({
        RANDY_PLAYER_BACKEND: 'lms', LMS_SERVER_URL: 'http://localhost:9000', LMS_PLAYER_ID: 'local-player'
    });
    assert.equal(players[0].options.backend, 'lms');
    assert.equal(players[0].options.serverUrl, 'http://localhost:9000');
    assert.equal(players[0].options.playerId, 'local-player');
    socket.emit('playsong', 0); await flush();
    assert.ok(sent.some(event => event.name === 'nowplaying' && event.data.title === songs[0].tags.common.title));
    players[0].emit('status', { playbackId: context.playbackId, changed: ['position', 'duration', 'volume'],
        position: 2, duration: 10, seekable: true, volume: 50 });
    assert.ok(sent.some(event => event.name === 'pos' && event.data === 2));
    let settings;
    await routes.get('/getSettings')({}, { header: () => {}, json: value => { settings = value; }, send: value => { settings = value; } });
    assert.equal(settings.audiodevices.length, 0);
    players[0].emit('playback-error', { playbackId: context.playbackId, error: new Error('Disconnected'), restart: false });
    assert.equal(players.length, 1); assert.equal(playlist.nextCalls, 0);
    players[0].emit('ended', { playbackId: context.playbackId }); await flush();
    assert.equal(playlist.nextCalls, 1);
});

test('LMS load failure does not restart backend or advance queue', async () => {
    const { socket, players, playlist } = await server({ RANDY_PLAYER_BACKEND: 'lms', LMS_PLAYER_ID: 'local' });
    players[0].loadAndPlay = async () => { throw new Error('LMS unavailable'); };
    socket.emit('playsong', 0); await flush();
    assert.equal(players.length, 1); assert.equal(playlist.nextCalls, 0);
});
