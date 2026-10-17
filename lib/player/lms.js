'use strict';

const { EventEmitter } = require('node:events');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const isHTTP = value => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); }
    catch { return false; }
};
const text = value => typeof value === 'string' ? value.trim() : '';
// Only individual tracks: accepting albums/playlists here would hand the queue to LMS.
const isSpotifyTrack = value => typeof value === 'string' && /^spotify:(?:\/\/)?track:[A-Za-z0-9]{22}$/.test(value);
const mediaIdentity = value => isSpotifyTrack(value) ? value.replace('spotify://', 'spotify:') : value;

// LMS status tags o/T/I/H/r describe the source, not the audio device output.
function audioStats(track) {
    const fields = [];
    const codec = text(track.type).toUpperCase();
    if (codec) fields.push(codec === 'FLC' ? 'FLAC' : codec);
    const rate = number(track.samplerate), bits = number(track.samplesize);
    if (rate > 0) fields.push((rate / 1000) + 'kHz');
    if (bits > 0) fields.push(bits + 'bit');
    // LMS prettyBitRate includes units and may append CBR/VBR. Do not guess
    // units for an unlabelled plugin value or derive bitrate from file size.
    const bitrate = text(track.bitrate).match(/^(\d+(?:\.\d+)?)\s*(?:(k|m)(?:bps|bit\/s)?|bps|bit\/s)(?:\s+(?:CBR|VBR))?$/i);
    if (bitrate && Number(bitrate[1]) > 0) {
        const scale = ({ k: 1, m: 1000 })[(bitrate[2] || '').toLowerCase()] || 0.001;
        fields.push(Number((Number(bitrate[1]) * scale).toFixed(3)) + 'kbps');
    }
    return fields.join(' ');
}

class LMSPlayer extends EventEmitter {
    constructor(options = {}, dependencies = {}) {
        super();
        this.url = new URL('/jsonrpc.js', options.serverUrl || 'http://127.0.0.1:9000').href;
        this.playerId = options.playerId;
        this.fetch = dependencies.fetch || globalThis.fetch;
        this.pollInterval = options.pollInterval || 250;
        this.timeout = options.requestTimeout || 3000;
        // Loading/starting a real file can take longer than an ordinary status query.
        this.loadTimeout = options.loadTimeout || 15000;
        this.streamStartTimeout = options.streamStartTimeout || 15000;
        this.retryInitial = options.retryInitial || 1000;
        this.retryMax = options.retryMax || 12000;
        this.retryDelay = this.retryInitial;
        this.nextPollDelay = this.retryInitial;
        this.monitoring = false;
        this.pendingVolume = null;
        this.desiredVolume = null;
        this.status = { playbackId: null, connected: false, state: 'stopped', connectionState: 'connecting', position: null,
            duration: null, seekable: false, volume: null };
        this.current = null;
        this.epoch = 0;
        this.requestId = 0;
        this.pollSequence = 0;
        this.controllers = new Set();
        this.commands = Promise.resolve();
        this.closed = false;
    }

    async _rpc(command, timeout = this.timeout, playerId = this.playerId) {
        if (this.closed) throw new Error('LMS adapter is closed');
        if (!this.playerId) throw new Error('LMS_PLAYER_ID is required');
        const controller = new AbortController();
        this.controllers.add(controller);
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const id = ++this.requestId;
            const response = await this.fetch(this.url, { method: 'POST',
                headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
                body: JSON.stringify({ id, method: 'slim.request', params: [playerId, command] }) });
            if (!response.ok) throw new Error('LMS HTTP ' + response.status);
            const body = await response.json();
            if (body.error) throw Object.assign(new Error('LMS JSON-RPC: ' + JSON.stringify(body.error)), { code: 'LMS_RPC_ERROR' });
            if (!body.result || typeof body.result !== 'object') throw new Error('Invalid LMS JSON-RPC response');
            return body.result;
        } finally {
            clearTimeout(timer);
            this.controllers.delete(controller);
        }
    }

    _publish(values) {
        const changed = Object.keys(values).filter(key => this.status[key] !== values[key]);
        Object.assign(this.status, values);
        if (changed.length) this.emit('status', { ...this.status, changed });
    }

    _connection(state, error) {
        const connected = state === 'connected';
        if (state !== this.status.connectionState) {
            this._publish({ connected, connectionState: state });
            const detail = error && new Error('LMS (' + this.playerId + '): ' + error.message +
                (error.cause?.code ? ' [' + error.cause.code + ']' : ''), { cause: error });
            this.emit('connection-change', { connected, state, playbackId: this.current?.id ?? null, error: detail });
        }
    }

    async _presence() {
        // A status query for an unknown player can close the HTTP socket in LMS 9.1.
        // Discover globally first, so this is reported as waiting for player, not bad media.
        const raw = await this._rpc(['players', '0', '999'], this.timeout, '');
        if (!Array.isArray(raw.players_loop) && number(raw.count) !== 0) throw new Error('Invalid LMS player discovery response');
        const player = raw.players_loop?.find(item => item.playerid?.toLowerCase() === this.playerId.toLowerCase());
        if (!player || number(player.connected) !== 1) {
            throw Object.assign(new Error('Configured player is absent or disconnected'), { code: 'LMS_PLAYER_UNAVAILABLE' });
        }
    }

    _failure(error, token = this.current) {
        if (this.closed || token !== this.current) return;
        if (this.desiredVolume !== null) this.pendingVolume = this.desiredVolume;
        if (token && !token.stopped && !token.ended) {
            if (token.loaded && !token.stream && this.status.seekable && !token.positionRequested) {
                token.resumePosition = this.status.position;
            }
            token.pending = true;
            token.loaded = false;
            token.previous = null;
            token.startAt = Date.now();
        }
        this._connection(error.code === 'LMS_PLAYER_UNAVAILABLE' ? 'waiting-for-player' : 'lms-unavailable', error);
        this.nextPollDelay = this.retryDelay;
        this.retryDelay = Math.min(this.retryDelay * 2, this.retryMax);
        this._schedule();
    }

    _schedule() {
        clearTimeout(this.timer);
        if (!this.closed && this.monitoring) this.timer = setTimeout(async () => {
            await this._poll();
            this._schedule();
        }, this.nextPollDelay);
    }

    async connect() {
        if (!this.playerId) throw new Error('LMS_PLAYER_ID is required');
        this.monitoring = true;
        // Initialization succeeds while infrastructure is unavailable. The current
        // playback request and volume remain pending until both services are ready.
        try { await this._poll(); }
        finally { this._schedule(); }
    }

    async _poll(duringMutation = false) {
        if (this.mutating && !duringMutation) return;
        const token = this.current, epoch = this.epoch;
        const sequence = ++this.pollSequence;
        try {
            if (!this.status.connected) {
                await this._presence();
                if (this.closed || epoch !== this.epoch || token !== this.current || sequence !== this.pollSequence) return;
            }
            const raw = await this._rpc(['status', '-', '1', 'tags:uNoTIHraldK']);
            if (this.closed || epoch !== this.epoch || token !== this.current || sequence !== this.pollSequence) return;
            if (number(raw.player_connected) !== 1) throw Object.assign(new Error('Configured player is absent or disconnected'), { code: 'LMS_PLAYER_UNAVAILABLE' });
            this._connection('connected');
            if (!duringMutation && (this.pendingVolume !== null || token?.pending || token?.stopPending)) {
                await this._restore(token);
                return;
            }
            this.retryDelay = this.retryInitial;
            this.nextPollDelay = this.pollInterval;
            const values = { volume: number(raw['mixer volume']) };
            this._publish(values);
            if (!token) {
                this._publish(values);
                return;
            }
            if (!token.loaded || token.stopped || token.ended) return;
            let file = raw.playlist_loop && raw.playlist_loop[0] && raw.playlist_loop[0].url;
            if (file && file.startsWith('file:')) file = fileURLToPath(file);
            // The remote server may still report the replaced track after load acknowledgement.
            if (mediaIdentity(file) !== mediaIdentity(token.file)) return;
            const position = number(raw.time), duration = token.stream ? null : number(raw.duration);
            const state = ({ play: 'playing', pause: 'paused', stop: 'stopped' })[raw.mode];
            if (!state) return;
            this._publish({ ...values, playbackId: token.id, position, duration,
                seekable: !token.stream && number(raw.can_seek) === 1, state,
                audioStats: audioStats(raw.playlist_loop[0]) });
            if (token !== this.current || epoch !== this.epoch || token.stopped) return;
            if (state === 'playing' || state === 'paused') token.paused = state === 'paused';
            if (!token.stream && position !== null) {
                token.resumePosition = position; token.resumeDuration = duration; token.positionRequested = false;
            }
            if (isSpotifyTrack(token.file)) {
                const track = raw.playlist_loop[0];
                const metadata = { title: text(track.title), artist: text(track.artist), album: text(track.album),
                    artwork: text(track.artwork_url) };
                if (JSON.stringify(metadata) !== JSON.stringify(this.status.trackMetadata)) {
                    this._publish({ trackMetadata: metadata });
                }
                if (token !== this.current || epoch !== this.epoch || token.stopped) return;
            }
            if (token.stream) {
                const track = raw.playlist_loop[0];
                const stationName = isHTTP(track.remote_title) ? '' : text(track.remote_title);
                let title = text(raw.current_title);
                // LMS falls back to the URL/station label when no ICY title exists.
                if (isHTTP(title) || title === stationName || title === token.stationTitle) title = '';
                const metadata = { title, stationName };
                if (JSON.stringify(metadata) !== JSON.stringify(this.status.radioMetadata)) {
                    this._publish({ radioMetadata: metadata });
                }
                if (token !== this.current || epoch !== this.epoch || token.stopped) return;
                if (state === 'playing' && position > 0 && number(raw.waitingToPlay) !== 1) token.started = true;
                if (state === 'paused') token.startAt = Date.now();
                // Live programme durations/metadata changes are never file EOF. Initial idle
                // is normal while buffering; only a bounded, unpaused startup failure skips.
                if (!token.started && !token.paused && state !== 'paused' && Date.now() - token.startAt >= this.streamStartTimeout) {
                    token.ended = true;
                    const error = new Error('LMS stream did not start within ' + this.streamStartTimeout + ' ms: ' + token.file);
                    this.emit('playback-error', { playbackId: token.id, error, restart: false });
                    if (token === this.current && !token.stopped && !this.closed) {
                        this.emit('ended', { playbackId: token.id, reason: 'error' });
                    }
                }
                return;
            }
            const previous = token.previous;
            token.previous = { state, position, duration, at: Date.now() };
            // Spotty can omit duration in the first stopped snapshot, then restore
            // it on the next poll. Use the witnessed current track's duration.
            const endDuration = duration ?? previous?.duration;
            // Require a witnessed run up to the end and a subsequent stop. Initial idle,
            // pause, explicit stop, replacement and observations across outages cannot end a track.
            if (state === 'stopped' && previous && previous.state === 'playing' && endDuration > 0 &&
                previous.position > 0 && previous.position + Math.min((Date.now() - previous.at) / 1000, 0.75) >= endDuration - 0.1) {
                token.ended = true;
                this.emit('ended', { playbackId: token.id });
            }
        } catch (error) {
            if (epoch !== this.epoch || token !== this.current || this.closed || sequence !== this.pollSequence) return;
            this._failure(error, token);
            // Infrastructure errors never emit playback-error or ended.
        }
    }

    _enqueue(operation) {
        const task = this.commands.then(async () => {
            this.mutating = true;
            ++this.epoch;
            try { return await operation(); }
            finally { this.mutating = false; }
        });
        this.commands = task.catch(() => {});
        return task;
    }

    loadAndPlay(song, { playbackId } = {}) {
        if (!song || !(path.isAbsolute(song.songfile || '') || isHTTP(song.songfile) || isSpotifyTrack(song.songfile)) || playbackId == null) {
            const error = new Error('LMS requires an absolute local songfile, HTTP(S) stream URL, or individual spotify:track URI and playbackId');
            this.emit('playback-error', { playbackId: playbackId ?? null, error, restart: false });
            return Promise.reject(error);
        }
        const token = { id: playbackId, file: song.songfile, loaded: false, stopped: false, ended: false, previous: null,
            stream: isHTTP(song.songfile), stationTitle: text(song.tags?.common?.title), started: false,
            paused: false, pending: true, stopPending: false, resumePosition: null, startAt: Date.now() };
        this.current = token;
        ++this.epoch;
        this._publish({ playbackId, state: 'stopped', position: null, duration: null, seekable: false, audioStats: '',
            ...(this.status.radioMetadata ? { radioMetadata: null } : {}),
            ...(this.status.trackMetadata ? { trackMetadata: null } : {}) });
        if (!this.monitoring) return this.connect();
        return this.status.connected ? this._restore(token) : Promise.resolve();
    }

    _restore(token) {
        return this._enqueue(async () => {
            if (this.closed || !this.status.connected) return;
            let globalOperation = true;
            try {
                if (this.pendingVolume !== null) {
                    const volume = this.pendingVolume;
                    await this._rpc(['mixer', 'volume', volume]);
                    if (volume === this.pendingVolume) this.pendingVolume = null;
                }
                if (token !== this.current || this.closed) return;
                globalOperation = false;
                if (token?.stopPending) {
                    await this._rpc(['stop']);
                    if (token !== this.current || this.closed) return;
                    token.stopPending = false;
                    this._publish({ state: 'stopped' });
                } else if (token?.pending && !token.stopped && !token.ended) {
                    await this._load(token);
                }
                if (!this.closed && this.status.connected) { ++this.epoch; await this._poll(true); }
            } catch (error) { this._failure(error, globalOperation ? this.current : token); }
        });
    }

    async _load(token) {
        const active = () => !this.closed && this.current === token && !token.stopped && !token.ended;
        try {
            this._publish({ state: 'stopped', position: null, duration: null, seekable: false });
            for (const command of [['playlist', 'shuffle', '0'], ['playlist', 'repeat', '0'],
                ['playlist', 'play', token.file]]) {
                if (!active()) return;
                await this._rpc(command, command[1] === 'play' ? this.loadTimeout : this.timeout);
            }
            if (!active()) return;
            if (!token.stream && token.resumePosition > 0) {
                // Pause while restoring position, then honor Randy's latest play/pause intent.
                await this._rpc(['pause', '1']);
                if (!active()) return;
                const position = token.resumeDuration > 0 ? Math.min(token.resumePosition, Math.max(0, token.resumeDuration - 0.75)) : token.resumePosition;
                await this._rpc(['time', String(position)]);
            }
            if (!active()) return;
            await this._rpc(token.paused ? ['pause', '1'] : ['play'], this.loadTimeout);
            if (!active()) return;
            token.pending = false;
            token.loaded = true;
            token.started = false;
            token.previous = null;
            token.startAt = Date.now();
        } catch (error) {
            if (!active()) return;
            // API/transport failures can race a player restart, even if discovery
            // succeeded just before the command. Only validated media errors (such
            // as the live startup watchdog) may abandon this playback request.
            this._failure(error, token);
        }
    }

    _control(command, stopping = false, trackScoped = true) {
        if (!trackScoped && !this.status.connected) return Promise.resolve();
        const token = this.current;
        ++this.epoch;
        if (token && trackScoped) {
            token.previous = null;
            if (stopping) {
                token.stopped = true; token.pending = false; token.stopPending = true;
                token.resumePosition = null; token.positionRequested = false;
            }
        }
        return this._enqueue(async () => {
            if (this.closed || (trackScoped && token !== this.current) || !this.status.connected) return;
            try {
                await this._rpc(command);
                if ((trackScoped && token !== this.current) || this.closed) return;
                if (!trackScoped && command[2] === this.pendingVolume) this.pendingVolume = null;
                ++this.epoch;
                if (stopping) { if (token) token.stopPending = false; this._publish({ state: 'stopped' }); }
                await this._poll(true);
            } catch (error) { this._failure(error, trackScoped ? token : this.current); }
        });
    }

    play() {
        const token = this.current;
        if (token) {
            if (token.stopped) {
                token.started = false; token.resumePosition = null; token.loaded = false;
                if (!token.ended) token.pending = true;
            }
            if (!this.status.connected && !token.ended) token.pending = true;
            token.stopped = false; token.stopPending = false; token.paused = false;
            token.startAt = Date.now();
            if (token.pending && this.status.connected) return this._restore(token);
        }
        return this._control(['play']);
    }
    pause() { if (this.current) this.current.paused = true; return this._control(['pause', '1']); }
    stop() { return this._control(['stop'], true); }
    seek(seconds) {
        if (this.current && !this.current.stream) {
            this.current.resumePosition = Number(seconds); this.current.positionRequested = true;
        }
        return this._control(['time', String(seconds)]);
    }
    // Volume belongs to the player and must survive a concurrent track selection/outage.
    setVolume(percent) {
        this.pendingVolume = String(percent);
        this.desiredVolume = this.pendingVolume;
        return this._control(['mixer', 'volume', this.pendingVolume], false, false);
    }
    async getStatus() { return { ...this.status }; }
    async close() {
        this.closed = true;
        ++this.epoch;
        clearTimeout(this.timer);
        for (const controller of this.controllers) controller.abort();
        this._connection('closed');
    }
}

module.exports = (options, dependencies) => new LMSPlayer(options, dependencies);
