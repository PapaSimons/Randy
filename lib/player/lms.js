'use strict';

const { EventEmitter } = require('node:events');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

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
        this.status = { playbackId: null, connected: false, state: 'stopped', position: null,
            duration: null, seekable: false, volume: null };
        this.current = null;
        this.epoch = 0;
        this.requestId = 0;
        this.pollSequence = 0;
        this.controllers = new Set();
        this.commands = Promise.resolve();
        this.closed = false;
        this.lastError = null;
    }

    async _rpc(command, timeout = this.timeout) {
        if (this.closed) throw new Error('LMS adapter is closed');
        if (!this.playerId) throw new Error('LMS_PLAYER_ID is required');
        const controller = new AbortController();
        this.controllers.add(controller);
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const id = ++this.requestId;
            const response = await this.fetch(this.url, { method: 'POST',
                headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
                body: JSON.stringify({ id, method: 'slim.request', params: [this.playerId, command] }) });
            if (!response.ok) throw new Error('LMS HTTP ' + response.status);
            const body = await response.json();
            if (body.error) throw new Error('LMS JSON-RPC: ' + JSON.stringify(body.error));
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

    _connection(connected) {
        if (connected !== this.status.connected) {
            this._publish({ connected });
            this.emit('connection-change', { connected });
        }
        if (connected) this.lastError = null;
    }

    _failure(error, token = this.current) {
        if (this.closed || token !== this.current) return;
        // Losing observations disarms completion until a fresh playing status arrives.
        if (token) token.previous = null;
        this._connection(false);
        if (this.lastError !== error.message) {
            this.lastError = error.message;
            this.emit('playback-error', { playbackId: token ? token.id : null,
                error: new Error('LMS (' + this.playerId + '): ' + error.message), restart: false });
        }
    }

    _schedule() {
        clearTimeout(this.timer);
        if (!this.closed) this.timer = setTimeout(async () => {
            await this._poll();
            this._schedule();
        }, this.pollInterval);
    }

    async connect() {
        try {
            await this._poll(true);
        } finally {
            this._schedule();
        }
    }

    async _poll(throwError = false, duringMutation = false) {
        if (this.mutating && !duringMutation) return;
        const token = this.current, epoch = this.epoch;
        const sequence = ++this.pollSequence;
        try {
            const raw = await this._rpc(['status', '-', '1', 'tags:u']);
            if (this.closed || epoch !== this.epoch || token !== this.current || sequence !== this.pollSequence) return;
            if (number(raw.player_connected) !== 1) throw new Error('Configured player is absent or disconnected');
            this._connection(true);
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
            if (file !== token.file) return;
            const position = number(raw.time), duration = number(raw.duration);
            const state = ({ play: 'playing', pause: 'paused', stop: 'stopped' })[raw.mode];
            if (!state) return;
            this._publish({ ...values, playbackId: token.id, position, duration,
                seekable: number(raw.can_seek) === 1, state });
            if (token !== this.current || epoch !== this.epoch || token.stopped) return;
            const previous = token.previous;
            token.previous = { state, position, duration, at: Date.now() };
            // Require a witnessed run up to the end and a subsequent stop. Initial idle,
            // pause, explicit stop, replacement and observations across outages cannot end a track.
            if (state === 'stopped' && previous && previous.state === 'playing' && duration > 0 &&
                previous.position > 0 && previous.position + Math.min((Date.now() - previous.at) / 1000, 0.75) >= duration - 0.1) {
                token.ended = true;
                this.emit('ended', { playbackId: token.id });
            }
        } catch (error) {
            if (epoch !== this.epoch || token !== this.current || this.closed || sequence !== this.pollSequence) return;
            this._failure(error, token);
            if (throwError) throw error;
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
        if (!song || !path.isAbsolute(song.songfile || '') || playbackId == null) {
            const error = new Error('LMS requires an absolute local songfile and playbackId');
            this.emit('playback-error', { playbackId: playbackId ?? null, error, restart: false });
            return Promise.reject(error);
        }
        const token = { id: playbackId, file: song.songfile, loaded: false, stopped: false, ended: false, previous: null };
        this.current = token;
        ++this.epoch;
        this._publish({ playbackId, state: 'stopped', position: null, duration: null, seekable: false });
        return this._enqueue(async () => {
            const active = () => !this.closed && this.current === token && !token.stopped;
            if (!active()) return;
            try {
                // Check player presence before issuing mutations; never enqueue Randy's full queue.
                const raw = await this._rpc(['status', '-', '1']);
                if (!active()) return;
                if (number(raw.player_connected) !== 1) throw new Error('Configured player is absent or disconnected');
                for (const command of [['playlist', 'shuffle', '0'], ['playlist', 'repeat', '0'],
                    ['playlist', 'play', token.file], ['play']]) {
                    if (!active()) return;
                    await this._rpc(command, command[0] === 'play' || command[1] === 'play' ? this.loadTimeout : this.timeout);
                }
                if (active()) { token.loaded = true; ++this.epoch; await this._poll(false, true); }
            } catch (error) { this._failure(error, token); if (active()) throw error; }
        });
    }

    _control(command, stopping = false) {
        const token = this.current;
        ++this.epoch;
        if (token) { token.previous = null; if (stopping) token.stopped = true; }
        return this._enqueue(async () => {
            if (this.closed || token !== this.current) return;
            try {
                await this._rpc(command);
                if (token !== this.current || this.closed) return;
                ++this.epoch;
                if (stopping) this._publish({ state: 'stopped' });
                await this._poll(false, true);
            } catch (error) { this._failure(error, token); }
        });
    }

    play() { if (this.current) this.current.stopped = false; return this._control(['play']); }
    pause() { return this._control(['pause', '1']); }
    stop() { return this._control(['stop'], true); }
    seek(seconds) { return this._control(['time', String(seconds)]); }
    setVolume(percent) { return this._control(['mixer', 'volume', String(percent)]); }
    async getStatus() { return { ...this.status }; }
    async close() {
        this.closed = true;
        ++this.epoch;
        clearTimeout(this.timer);
        for (const controller of this.controllers) controller.abort();
        this._connection(false);
    }
}

module.exports = (options, dependencies) => new LMSPlayer(options, dependencies);
