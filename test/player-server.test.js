'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const flush = () => new Promise(resolve => setImmediate(resolve));

// Execute the actual server wiring without starting HTTP, MPV or persistent databases.
async function server(env = {}, options = {}) {
    const sent = [], players = [], routes = new Map();
    const signals = new Map(), exits = [];
    const io = new EventEmitter();
    io.sockets = { emit: (name, data) => sent.push({ name, data }) };
    const songs = ['A', 'B'].map(title => ({
        songfile: '/music/' + title + '.flac', albumart: '/cover.jpg',
        tags: { common: { title, artist: 'Artist', album: 'Album' } }
    }));
    const settings = { musicfolders: null, audioOutputDevice: 'auto', playonstart: options.playonstart || 'false' };
    const playlist = {
        index: 0, nextCalls: 0,
        getSettings: () => settings,
        setSetting: (key, value) => { settings[key] = value; },
        getPlayList: () => songs,
        getPlaying: () => playlist.index,
        getCurrentSong: () => songs[playlist.index],
        getStickyList: limit => { playlist.stickyLimit = limit; return []; },
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
        player.getStatus = () => Promise.resolve(options.status || {});
        players.push(player);
        return player;
    }
    const app = { get: (name, handler) => routes.set(name, handler), use: () => {}, post: (name, handler) => routes.set(name, handler) };
    const express = () => app;
    express.static = () => {};
    const modules = {
        'console-stamp': () => {}, express,
        http: { Server: () => ({ listen: (port, callback) => callback() }) },
        'socket.io': () => io,
        'body-parser': { json: () => {}, urlencoded: () => {} },
        './lib/playlist_utils.js': playlist,
        './lib/player': createPlayer,
        './lib/spotify-item': require('../lib/spotify-item'),
        './lib/spotify': require('../lib/spotify'),
        './lib/squeezelite-output': require('../lib/squeezelite-output'),
        './lib/spotify-routes': require('../lib/spotify-routes'),
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
        process: { env, argv: [], platform: 'darwin', on: (name, handler) => signals.set(name, handler), exit: code => exits.push(code) },
        setTimeout: (callback, ms) => setTimeout(callback, options.fastShutdownDeadline && ms === 4000 ? 1 : ms), clearTimeout, URL
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8'), context);
    await flush();
    const socket = new EventEmitter();
    io.emit('connection', socket);
    return { context, socket, players, sent, playlist, routes, songs, io, signals, exits };
}

for (const signal of ['SIGINT', 'SIGTERM']) test(signal + ' stops LMS playback before closing without advancing or repeating cleanup', async () => {
    const f = await server({ RANDY_PLAYER_BACKEND: 'lms' });
    f.socket.emit('playsong', 0); await flush();
    const player = f.players[0]; player.calls.length = 0;
    player.stop = async () => {
        player.calls.push(['stop']);
        player.emit('ended', { playbackId: f.context.playbackId });
    };
    await f.signals.get(signal)(); await f.signals.get(signal)();
    assert.deepEqual(player.calls, [['stop'], ['close']]);
    assert.equal(f.playlist.nextCalls, 0);
    assert.deepEqual(f.exits, [0]);
    f.socket.emit('playsong', 1); await flush();
    assert.deepEqual(player.calls, [['stop'], ['close']]);
});

test('graceful shutdown preserves MPV close behavior', async () => {
    const f = await server(); f.players[0].calls.length = 0;
    await f.signals.get('SIGTERM')();
    assert.deepEqual(f.players[0].calls, [['close']]); assert.deepEqual(f.exits, [0]);
});

for (const failure of ['reject', 'timeout']) test('LMS shutdown still closes and exits after stop ' + failure, async () => {
    const f = await server({ RANDY_PLAYER_BACKEND: 'lms' }, { fastShutdownDeadline: true });
    f.players[0].stop = () => failure === 'reject' ? Promise.reject(new Error('LMS unavailable')) : new Promise(() => {});
    f.players[0].calls.length = 0;
    await f.signals.get('SIGINT')();
    assert.deepEqual(f.players[0].calls, [['close']]); assert.deepEqual(f.exits, [0]);
});

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

test('sticky-list API accepts the unchanged frontend empty-body request', async () => {
    const { routes, playlist } = await server();
    let result;
    const response = { header: () => {}, json: value => { result = value; } };
    routes.get('/getStickyList')({}, response);
    assert.equal(playlist.stickyLimit, undefined);
    assert.equal(result.results.length, 0);
    routes.get('/getStickyList')({ body: { limit: 5 } }, response);
    assert.equal(playlist.stickyLimit, 5);
});

test('LMS radio uses unchanged nowplaying/problem contracts, station art, and rejects stale metadata', async () => {
    const { socket, context, players, sent, songs } = await server({ RANDY_PLAYER_BACKEND: 'lms' });
    songs[0].type = 'radio'; songs[0].songfile = 'https://radio.example/live';
    const radioMetadata = { title: 'Native artist - Native track', stationName: 'Native station' };
    players[0].getStatus = async () => ({ radioMetadata });
    socket.emit('playsong', 0); await flush();
    const initial = sent.filter(e => e.name === 'nowplaying').at(-1).data;
    assert.equal(initial.title, radioMetadata.title); assert.equal(initial.albumart, '/cover.jpg');
    assert.equal(initial.album, 'Native station');
    const status = { playbackId: context.playbackId, radioMetadata, changed: ['radioMetadata'] };
    const count = sent.length;
    players[0].emit('status', { ...status, playbackId: context.playbackId - 1 });
    assert.equal(sent.length, count);
    players[0].emit('status', { ...status, radioMetadata: { title: '', stationName: '' } });
    assert.equal(sent.at(-1).data.title, 'A'); assert.equal(sent.at(-1).data.album, 'A');
    players[0].emit('playback-error', { playbackId: context.playbackId, error: new Error('bad stream'), restart: false });
    assert.equal(sent.at(-1).name, 'problem');
});

test('LMS audio stats use the existing Socket.IO contract and reject stale updates', async () => {
    const { socket, context, players, sent } = await server({ RANDY_PLAYER_BACKEND: 'lms' });
    socket.emit('playsong', 0); await flush();
    const status = { playbackId: context.playbackId, audioStats: 'FLAC 44.1kHz 16bit 543kbps', changed: ['audioStats'] };
    players[0].emit('status', status);
    assert.equal(sent.at(-1).name, 'audiostats'); assert.equal(sent.at(-1).data, status.audioStats);
    const count = sent.length;
    players[0].emit('status', { ...status, playbackId: context.playbackId - 1 });
    assert.equal(sent.length, count);
    players[0].emit('status', { ...status, audioStats: '' });
    assert.equal(sent.at(-1).name, 'audiostats'); assert.equal(sent.at(-1).data, '');
});

test('LMS replays stats after track selection and playlist row rebuilds even for identical formats', async () => {
    const { context, socket, players, sent } = await server({ RANDY_PLAYER_BACKEND: 'lms' });
    const player = players[0], audioStats = 'MP3 RADIO 256kbps';
    player.getStatus = async () => ({ playbackId: context.playbackId, audioStats });
    player.loadAndPlay = async (song, { playbackId }) => {
        // LMS can publish its only changed-stats event before loadAndPlay resolves.
        player.emit('status', { playbackId, audioStats, changed: ['audioStats'] });
    };
    for (const index of [0, 1, 0]) {
        const start = sent.length;
        socket.emit('playsong', index); await flush();
        const events = sent.slice(start);
        const playlistIndex = events.findLastIndex(event => event.name === 'playlist');
        assert.ok(playlistIndex >= 0);
        assert.equal(events.at(-1).name, 'audiostats');
        assert.equal(events.at(-1).data, audioStats);
        assert.ok(events.findLastIndex(event => event.name === 'audiostats') > playlistIndex);
    }
    context.emitplaylist(); await flush();
    assert.equal(sent.at(-2).name, 'playlist');
    assert.equal(sent.at(-1).name, 'audiostats');
});

test('LMS replays cached audio stats to a newly connected browser', async () => {
    const { context, socket, players, io } = await server({ RANDY_PLAYER_BACKEND: 'lms' });
    socket.emit('playsong', 0); await flush();
    players[0].getStatus = async () => ({ playbackId: context.playbackId, audioStats: 'AAC 48kHz' });
    const browser = new EventEmitter(), events = [];
    for (const name of ['playlist', 'audiostats']) browser.on(name, data => events.push({ name, data }));
    io.emit('connection', browser); await flush();
    assert.deepEqual(events.map(event => event.name), ['playlist', 'audiostats']);
    assert.equal(events[1].data, 'AAC 48kHz');
});

test('delayed LMS audio stats replay cannot overwrite a newer selection', async () => {
    const { context, socket, players, sent } = await server({ RANDY_PLAYER_BACKEND: 'lms' });
    socket.emit('playsong', 0); await flush();
    const oldId = context.playbackId;
    let reply;
    players[0].getStatus = () => new Promise(resolve => { reply = resolve; });
    context.emitplaylist();
    players[0].getStatus = async () => ({ playbackId: context.playbackId, audioStats: 'FLAC 96kHz' });
    socket.emit('playsong', 1); await flush();
    const count = sent.length;
    reply({ playbackId: oldId, audioStats: 'OLD' }); await flush();
    assert.equal(sent.length, count);
    assert.equal(sent.at(-1).data, 'FLAC 96kHz');
});

test('delayed LMS metadata read cannot publish nowplaying after replacement', async () => {
    const { socket, players, sent } = await server({ RANDY_PLAYER_BACKEND: 'lms' });
    let finish; players[0].getStatus = () => new Promise(resolve => { finish = resolve; });
    socket.emit('playsong', 0); await flush();
    players[0].getStatus = async () => ({});
    socket.emit('playsong', 1); await flush(); const count = sent.length;
    finish({ radioMetadata: { title: 'Stale title', stationName: 'Stale station' } }); await flush();
    assert.equal(sent.length, count);
});

test('LMS unavailable at startup still initializes Randy and submits the selected startup request', async () => {
    const { players, playlist, context, sent } = await server({ RANDY_PLAYER_BACKEND: 'lms' }, {
        playonstart: 'true', status: { connected: false, connectionState: 'lms-unavailable' }
    });
    const player = players[0];
    assert.equal(player.calls.filter(c => c[0] === 'loadAndPlay').length, 1);
    assert.equal(playlist.nextCalls, 0);
    player.emit('connection-change', { state: 'waiting-for-player', connected: false, playbackId: context.playbackId });
    assert.equal(sent.at(-1).name, 'problem');
    assert.ok(sent.some(e => e.name === 'player-connection' && e.data.state === 'waiting-for-player'));
    player.emit('connection-change', { state: 'connected', connected: true, playbackId: context.playbackId });
    assert.equal(sent.at(-1).data.state, 'connected');
    assert.equal(player.calls.filter(c => c[0] === 'loadAndPlay').length, 1);
    assert.equal(playlist.nextCalls, 0);
});

test('stale LMS connection events cannot affect a replacement track or player', async () => {
    const { socket, players, context, sent, playlist } = await server({ RANDY_PLAYER_BACKEND: 'lms' });
    socket.emit('playsong', 0); await flush(); const oldId = context.playbackId;
    socket.emit('playsong', 1); await flush(); const before = sent.length;
    players[0].emit('connection-change', { state: 'lms-unavailable', connected: false, playbackId: oldId });
    assert.equal(sent.length, before);
    context.restartplayer(); await flush(); const after = sent.length;
    players[0].emit('connection-change', { state: 'waiting-for-player', connected: false, playbackId: context.playbackId });
    assert.equal(sent.length, after); assert.equal(playlist.nextCalls, 0);
});

test('LMS Play before the first load selects Randy current song even while disconnected', async () => {
    const { socket, players, playlist, songs } = await server({ RANDY_PLAYER_BACKEND: 'lms' }, {
        status: { connected: false, connectionState: 'lms-unavailable' }
    });
    socket.emit('play'); await flush();
    const load = players[0].calls.find(c => c[0] === 'loadAndPlay');
    assert.equal(load[1], songs[0]); assert.equal(playlist.nextCalls, 0);
    socket.emit('play'); await flush();
    assert.equal(players[0].calls.filter(c => c[0] === 'loadAndPlay').length, 1);
    assert.ok(players[0].calls.some(c => c[0] === 'play'));
});

test('Spotify metadata uses unchanged nowplaying fields and resolves LMS-relative artwork', async () => {
    const f = await server({ RANDY_PLAYER_BACKEND: 'lms', LMS_SERVER_URL: 'http://127.0.0.1:9000' });
    f.socket.emit('playsong', 0); await flush();
    const status = { playbackId: f.context.playbackId, trackMetadata: { title: 'Her Majesty', artist: 'The Beatles',
        album: 'Abbey Road', artwork: '/imageproxy/art/image.png' }, changed: ['trackMetadata'] };
    f.players[0].emit('status', status);
    const e = f.sent.at(-1); assert.equal(e.name, 'nowplaying');
    assert.equal(e.data.title, 'Her Majesty'); assert.equal(e.data.album, 'The Beatles • Abbey Road');
    assert.equal(e.data.albumart, 'http://127.0.0.1:9000/imageproxy/art/image.png');
    const count = f.sent.length;
    f.players[0].emit('status', { ...status, playbackId: f.context.playbackId - 1 });
    assert.equal(f.sent.length, count);
});

test('Spotify native metadata is replayed after playlist rebuilds and to a new browser', async () => {
    const f = await server({ RANDY_PLAYER_BACKEND: 'lms' });
    f.players[0].getStatus = async () => ({ playbackId: f.context.playbackId, audioStats: 'OGG 320kbps',
        trackMetadata: { title: 'Native Spotify title', artist: 'Artist', album: 'Album', artwork: '/cover.jpg' } });
    f.socket.emit('playsong', 0); await flush();
    const lastPlaylist = f.sent.findLastIndex(e => e.name === 'playlist');
    const lastMetadata = f.sent.findLastIndex(e => e.name === 'nowplaying' && e.data.title === 'Native Spotify title');
    assert.ok(lastMetadata > lastPlaylist);
    const browser = new EventEmitter(), events = [];
    browser.on('nowplaying', data => events.push(data));
    f.io.emit('connection', browser); await flush();
    assert.equal(events.at(-1).title, 'Native Spotify title');
    assert.equal(events.at(-1).albumart, 'http://127.0.0.1:9000/cover.jpg');
});

test('LMS playlist rebuild replays duration and position after the row is recreated', async () => {
    const f = await server({RANDY_PLAYER_BACKEND:'lms'});
    f.socket.emit('playsong',0);await flush();
    f.players[0].getStatus = async () => ({playbackId:f.context.playbackId,seekable:true,duration:155.6,position:12.5,audioStats:'OGG 320kbps'});
    f.context.emitplaylist();await flush();
    const index=f.sent.findLastIndex(e=>e.name==='playlist');
    assert.ok(f.sent.findLastIndex(e=>e.name==='duration'&&e.data===155.6)>index);
    assert.ok(f.sent.findLastIndex(e=>e.name==='pos'&&e.data===12.5)>index);
});
test('late seekability publishes existing duration so Spotify seek controls initialize',async()=>{
    const f=await server({RANDY_PLAYER_BACKEND:'lms'});
    f.socket.emit('playsong',0);await flush();
    f.players[0].emit('status',{playbackId:f.context.playbackId,seekable:true,duration:155.6,changed:['seekable']});
    assert.ok(f.sent.some(e=>e.name==='duration'&&e.data===155.6));
});
test('saved Spotify metadata and artwork are usable before LMS enriches the current track', async () => {
    const f=await server({RANDY_PLAYER_BACKEND:'lms'});
    f.songs[0]={type:'spotify',songfile:'spoton://track:3M0zi8iD2KRzY71XcGFUpE',albumart:'https://i.scdn.co/image/cover',tags:{common:{title:'Saved title',artist:'Saved artist',album:'Saved album'},format:{}}};
    f.socket.emit('playsong',0);await flush();
    const value=f.sent.findLast(e=>e.name==='nowplaying').data;
    assert.equal(value.title,'Saved title');assert.equal(value.artist,'Saved artist');assert.equal(value.source,'spotify');
    assert.match(value.albumart,/^\/spotify\/artwork\?/);
});

test('actual local-search route completes while Spotify is stalled or unavailable', async () => {
    const f=await server({RANDY_PLAYER_BACKEND:'lms'});
    const local={albums:[{name:'Local album'}],files:[{name:'Local track'}],radiostations:[]};
    f.playlist.searchSongs=async()=>local;
    let finish;
    f.context.spotify.search=()=>new Promise(resolve=>{finish=resolve;});
    const remote={status(){return this;},json(value){this.value=value;}};
    const pending=f.routes.get('/spotify/search')({body:{keyword:'Artist'}},remote);
    const result={header(){},json(value){this.value=value;}};
    f.routes.get('/searchSongs')({body:{keyword:'Artist'}},result);await flush();
    assert.equal(result.value.results,local);assert.equal(remote.value,undefined);
    finish({tracks:[],albums:[],artists:[],playlists:[],message:'Spotify unavailable'});await pending;
    assert.equal(result.value.results,local);assert.equal(remote.value.results.tracks.length,0);
});

test('new browser receives current Connect metadata even though Connect has no Randy playbackId',async()=>{
 const f=await server({RANDY_PLAYER_BACKEND:'lms'});
 const external=f.context.spotify.ownership.observe({mode:'play',time:12,duration:200,playlist_loop:[{url:'spoton://connect-123',title:'Connect title',artist:'Connect artist',album:'Connect album',artwork_url:'https://i.scdn.co/image/cover'}]});
 f.players[0].getStatus=async()=>({playbackId:null,externalPlayback:external,audioStats:'PCM 320kbps'});
 const browser=new EventEmitter(),events=[];for(const name of ['nowplaying','spotify-ownership','pos'])browser.on(name,data=>events.push({name,data}));
 f.io.emit('connection',browser);await flush();
 const meta=events.findLast(e=>e.name==='nowplaying').data;assert.equal(meta.source,'spotify_connect');assert.equal(meta.title,'Connect title');
 assert.ok(events.some(e=>e.name==='spotify-ownership'&&e.data.state==='spotify_connect'));assert.equal(f.songs[0].tags.common.title,'A');
});
