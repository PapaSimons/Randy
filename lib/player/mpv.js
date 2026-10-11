'use strict';

const { EventEmitter } = require('events');
const { spawnSync } = require('child_process');
const os = require('os');
const createTransport = require('../mpv-wrapper');

// status: cached snapshot plus `changed` fields, tagged with the selected playbackId.
// ended: current item reached MPV idle (including failed-file idle, as in Randy).
// playback-error: tagged error and the existing recovery policy's restart flag.
// connection-change: connected flag and current playbackId.
// The mpv status extension passes existing metadata/device data through unchanged;
// it is not an audio-device or metadata abstraction.
const trackProperties = {
    'audio-pts': 'position',
    seekable: 'seekable',
    duration: 'duration',
    pause: 'paused',
    'media-title': 'mediaTitle',
    metadata: 'metadata',
    'audio-bitrate': 'bitrate'
};

class MPVPlayer extends EventEmitter {
    constructor(options = {}, dependencies = {}) {
        super();
        this._options = options;
        this._createTransport = dependencies.createTransport || createTransport;
        this._killMPV = dependencies.killMPV || (() => spawnSync('killall', ['mpv']));
        this._client = null;
        this._transport = null;
        this._closed = false;
        this._observerId = 1;
        this._observers = new Map();
        this._trackObservers = [];
        this._entries = new Map();
        this._current = null;
        this._starts = [];
        this._redirecting = null;
        this._pendingEnd = null;
        this._loads = Promise.resolve();
        this._status = {
            playbackId: null, connected: false, state: 'stopped',
            position: null, duration: null, seekable: true, volume: null,
            // Temporary MPV-specific data preserves the existing settings/metadata UI.
            mpv: { audioDevices: [], audioOutput: null, mediaTitle: null, metadata: null, audioStats: null }
        };
    }

    connect() {
        if (this._closed) return Promise.reject(new Error('Player is closed'));
        if (this._connection) return this._connection;
        this._connection = new Promise((resolve, reject) => {
            this._rejectConnection = reject;
            // Preserve Randy's existing startup/restart cleanup policy for now.
            this._killMPV();
            const args = [
                '--no-config', '--af-clr', '--vf-clr', '--vid=no', '--no-video',
                'script-opts=ytdl_hook-ytdl_path=yt-dlp', '--audio-display=no',
                '--no-initial-audio-sync', '--audio-format=float', '--audio-fallback-to-null=yes',
                '--audio-device=' + (this._options.audioOutputDevice === undefined ? 'auto' : this._options.audioOutputDevice),
                '--replaygain=no', '--ytdl-format=bestaudio'
            ];
            if ((this._options.platform || os.platform()) === 'linux') {
                args.push('--alsa-resample=yes', '--ao=alsa', '--volume=100', '--volume-max=100');
            }
            this._transport = this._createTransport({ args }, (error, client) => {
                if (this._closed) return reject(new Error('Player closed while connecting'));
                if (error) return reject(error);
                this._client = client;
                client.on('property-change', event => this._propertyChanged(event));
                client.on('start-file', event => this._started(event));
                client.on('end-file', event => this._endFile(event));
                client.onIdle(() => this._idle());
                client.on('close', () => {
                    if (this._closed) return;
                    this._status.connected = false;
                    this.emit('connection-change', { connected: false, playbackId: this._status.playbackId });
                });
                this._status.connected = true;
                this._observe('volume', value => this._publish({ volume: value }, ['volume']));
                this._observe('audio-device-list', value => {
                    this._status.mpv.audioDevices = value;
                    this._publish({}, ['audioDevices']);
                });
                this._observe('ao', value => {
                    this._status.mpv.audioOutput = value;
                    this._publish({}, ['audioOutput']);
                });
                this.emit('connection-change', { connected: true, playbackId: null });
                resolve();
            });
        });
        return this._connection;
    }

    loadAndPlay(song, { playbackId } = {}) {
        if (!song || !song.songfile || playbackId == null) {
            return Promise.reject(new Error('A songfile and playbackId are required'));
        }
        if (!this._client || this._closed) return Promise.reject(new Error('Player is not connected'));
        if (this._current) clearTimeout(this._current.watchdog);
        const token = { playbackId, loaded: false, ended: false, stopped: false };
        this._current = token;
        this._pendingEnd = null;
        this._unobserveTrack();
        this._status.playbackId = playbackId;
        this._status.state = 'loading';
        this._status.position = null;
        this._status.duration = null;
        this._status.mpv.mediaTitle = null;
        this._status.mpv.metadata = null;
        this._status.mpv.audioStats = null;
        token.watchdog = setTimeout(() => {
            if (this._isCurrent(token) && !token.loaded) {
                this._error(new Error('Player socket timed out'), token, true);
            }
        }, 3000);
        // Serialize loads; an older acknowledgement must never resume a newer track.
        const load = this._loads.then(async () => {
            if (!this._canLoad(token)) return;
            this._starts.push(token);
            try {
                await this._client.loadfile(song.songfile, 'replace');
                if (!this._canLoad(token)) return;
                token.loaded = true;
                clearTimeout(token.watchdog);
            } catch (error) {
                this._starts = this._starts.filter(start => start !== token);
                if (!this._canLoad(token)) return;
                // Randy previously logged load rejection and still unpaused MPV.
                this._error(error, token, false);
            }
            if (!this._canLoad(token)) return;
            await this._client.setProperty('pause', false);
            if (this._canLoad(token)) this._status.state = 'playing';
        }).catch(error => {
            if (this._isCurrent(token)) this._error(error, token, true);
        });
        this._loads = load;
        return load;
    }

    play() { return this._command(() => this._client.setProperty('pause', false)); }
    pause() { return this._command(() => this._client.setProperty('pause', true)); }
    seek(seconds) { return this._command(() => this._client.seek(seconds, 'absolute')); }
    setVolume(percent) { return this._command(() => this._client.setProperty('volume', percent)); }

    stop() {
        if (this._current) {
            this._current.stopped = true;
            clearTimeout(this._current.watchdog);
        }
        this._pendingEnd = null;
        const token = this._current;
        return this._command(() => this._client.stop()).then(() => {
            if (this._isCurrent(token)) this._publish({ state: 'stopped' }, ['state']);
        });
    }

    async getStatus() {
        return { ...this._status, mpv: { ...this._status.mpv } };
    }

    async close() {
        if (this._closed) return;
        this._closed = true;
        if (this._rejectConnection) this._rejectConnection(new Error('Player closed while connecting'));
        if (this._current) clearTimeout(this._current.watchdog);
        this._observers.clear();
        this._killMPV();
        if (this._transport) this._transport.close();
        this._status.connected = false;
        this.emit('connection-change', { connected: false, playbackId: this._status.playbackId });
    }

    _isCurrent(token) { return !this._closed && token === this._current; }
    _canLoad(token) { return this._isCurrent(token) && !token.stopped && !token.ended; }

    _error(error, token, restart) {
        if (token && !this._isCurrent(token)) return;
        if (this._closed) return;
        this.emit('playback-error', {
            playbackId: token ? token.playbackId : this._status.playbackId,
            error: error instanceof Error ? error : new Error(String(error)), restart
        });
    }

    async _command(command) {
        const token = this._current;
        try {
            if (!this._client || this._closed) throw new Error('Player is not connected');
            return await command();
        } catch (error) {
            this._error(error, token, false);
        }
    }

    _publish(values, changed) {
        if (this._closed) return;
        Object.assign(this._status, values);
        this.emit('status', { ...this._status, mpv: { ...this._status.mpv }, changed });
    }

    _observe(name, callback, token) {
        const id = this._observerId++;
        this._observers.set(id, { name, callback, token });
        if (token) this._trackObservers.push(id);
        this._client.command('observe_property', id, name).catch(error => this._error(error, token, false));
    }

    _unobserveTrack() {
        for (const id of this._trackObservers) {
            this._observers.delete(id);
            this._client.command('unobserve_property', id).catch(() => {});
        }
        this._trackObservers = [];
    }

    _propertyChanged(event) {
        const observer = this._observers.get(event.id);
        if (!observer || observer.name !== event.name) return;
        if (observer.token && !this._isCurrent(observer.token)) return;
        observer.callback(event.data);
    }

    _started(event) {
        const token = this._starts.shift() || this._redirecting;
        this._redirecting = null;
        if (!token || this._closed) return;
        this._entries.set(event.playlist_entry_id, token);
        if (!this._isCurrent(token) || token.stopped) return;
        this._unobserveTrack();
        for (const [property, field] of Object.entries(trackProperties)) {
            this._observe(property, value => {
                if (field === 'mediaTitle') {
                    token.loaded = true;
                    clearTimeout(token.watchdog);
                    this._status.mpv.mediaTitle = value;
                    this._publish({}, ['mediaTitle']);
                } else if (field === 'metadata') {
                    this._status.mpv.metadata = value;
                    this._publish({}, ['metadata']);
                } else if (field === 'bitrate') {
                    this._audioStats(value, token);
                } else if (field === 'paused') {
                    this._publish({ state: value ? 'paused' : 'playing' }, ['state']);
                } else {
                    this._publish({ [field]: value }, [field]);
                }
            }, token);
        }
    }

    _endFile(event) {
        const token = this._entries.get(event.playlist_entry_id);
        this._entries.delete(event.playlist_entry_id);
        if (!token || !this._isCurrent(token) || token.stopped || token.ended) return;
        if (event.reason === 'redirect') this._redirecting = token;
        // Keep Randy's idle-based completion policy, including failed-file advancement.
        // A replacement emits reason "stop" and must not advance the new selection.
        if (event.reason !== 'stop' && event.reason !== 'quit' && event.reason !== 'redirect') {
            this._pendingEnd = token;
        }
    }

    _idle() {
        const token = this._pendingEnd;
        this._pendingEnd = null;
        if (!token || !this._isCurrent(token) || token.stopped || token.ended) return;
        token.ended = true;
        clearTimeout(token.watchdog);
        this._publish({ state: 'stopped' }, ['state']);
        this.emit('ended', { playbackId: token.playbackId });
    }

    async _audioStats(bitrate, token) {
        if (!bitrate) return;
        try {
            const params = await this._client.getProperty('audio-out-params');
            if (!params || !this._isCurrent(token)) return;
            const format = await this._client.getProperty('file-format');
            if (!format || !this._isCurrent(token)) return;
            this._status.mpv.audioStats = format.toUpperCase().split(',')[0] + ',  ' +
                (params.samplerate / 1000).toFixed(1) + 'khz,  ' + params['channel-count'] +
                'ch,  ' + Math.round(bitrate / 1000) + 'kbs';
            this._publish({}, ['audioStats']);
        } catch (error) {
            this._error(error, token, false);
        }
    }
}

module.exports = (options, dependencies) => new MPVPlayer(options, dependencies);
