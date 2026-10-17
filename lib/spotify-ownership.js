'use strict';
const {EventEmitter} = require('node:events');
const media = require('./spotify-item');
const isConnect = raw => /^spoton:\/\/connect-/.test(raw?.playlist_loop?.[0]?.url || '') && !/SpotOn Browse/i.test(raw?.playlist_loop?.[0]?.type || '');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
class Ownership extends EventEmitter {
    constructor(spotify, options = {}) {
        super(); this.spotify = spotify; this.state = 'randy'; this.external = null;
        this.transition = 0; this.timeout = options.timeout || 7000; this.wait = options.wait || delay;
    }
    set(state) { if (this.state !== state) {const previous=this.state;this.state=state;this.lastMetadata=null;this.emit('change',{state,previous});} }
    getOwnership() { return this.state; }
    isConnectActive() { return this.state === 'spotify_connect' || (this.state === 'transitioning' && !!this.external); }
    observe(raw) {
        const url = raw.playlist_loop?.[0]?.url;
        if (!isConnect(raw)) {
            this.connectHistory = /^spoton:\/\/connect-/.test(url || '');
            if (this.connectHistory && this.state !== 'transitioning') {this.external=null;this.set('disconnected');}
            this.releasedURL = null;
            if (this.state === 'disconnected' && !this.external && !this.connectHistory) this.set('randy');
            return null;
        }
        if (url === this.releasedURL && this.state === 'randy') return null;
        const track=raw.playlist_loop[0];
        const numeric=value=>value!=null&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
        this.connectHistory=false;this.wasConnect=true;
        if (raw.mode === 'play' && numeric(raw.time) === 0) this.waitingSince ??= Date.now();
        else this.waitingSince = null;
        this.external={source:'spotify_connect',url,title:track.title || raw.current_title || 'Spotify Connect',artist:track.artist || '',album:track.album || '',
            artwork:media.artwork(track.artwork_url),seekable:Number(raw.can_seek)===1,position:numeric(raw.time),duration:numeric(raw.duration),volume:numeric(raw['mixer volume']),
            audioStalled:this.waitingSince != null && Date.now()-this.waitingSince>10000,
            state:({play:'playing',pause:'paused',stop:'stopped'})[raw.mode] || 'stopped'};
        if (this.state !== 'transitioning') this.set(this.preparing === this.transition ? 'transitioning' : 'spotify_connect');
        return this.external;
    }
    cancelPending() {
        ++this.transition;
        if (this.state === 'transitioning') this.set(this.external ? 'spotify_connect' : 'disconnected');
    }
    disconnected() { if (this.state !== 'transitioning') this.set('disconnected'); }
    async prepareForRandyPlayback(player, current = () => true) {
        const sequence=++this.transition;
        const active=()=>sequence===this.transition&&current();
        this.preparing=sequence;
        try {
            if (!this.isConnectActive() && !this.external) {
                const status=await player.getStatus();
                if (!active()) return false;
                if (!status.connected) {this.set('randy');return true;}
                let raw;
                try {raw=await this.spotify.rpc(['status','-','1','tags:uNoTIHraldK']);}
                catch {return active();} // The adapter retains normal infrastructure retries.
                if (!active()) return false;
                if (!isConnect(raw)) {this.set('randy');return true;}
                this.set('transitioning');this.observe(raw);
            }
            this.set('transitioning');
            try {
                // Stop also invalidates the adapter's old pending operations immediately.
                await player.stop(); if (!active()) return false;
                // LMS normally forwards pause, but SpotOn suppresses echoes during its
                // startup grace period. The documented helper pause avoids that race.
                const health=await (await this.spotify.request('/plugins/SpotOn/status/data')).json();
                const daemon=health.daemons?.find(d=>String(d.mac).toLowerCase()===this.spotify.playerId.toLowerCase());
                if (daemon?.alive && daemon.connectEnabled) {
                    const port=Number(daemon.streamPort);
                    if (!Number.isInteger(port)||port<1024||port>65535) throw new Error('SpotOn Connect control port is unavailable');
                    const control=new URL(this.spotify.base);control.protocol='http:';control.username='';control.password='';control.port=String(port);control.pathname='/control/pause';control.search='';control.hash='';
                    const reply=await this.spotify.fetch(control,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(4000)});
                    if (!reply.ok) throw new Error('SpotOn did not acknowledge Connect pause');
                }
                if (!active()) return false;
                await this.spotify.rpc(['playlist','clear']);
                const deadline=Date.now()+this.timeout;
                while (active() && Date.now()<deadline) {
                    const raw=await this.spotify.rpc(['status','-','1','tags:uNoTIHraldK']);
                    if (!active()) return false;
                    if (raw.mode==='stop' && Number(raw.playlist_tracks)===0) {
                        this.releasedURL=this.external?.url;this.external=null;this.set('randy');return true;
                    }
                    await this.wait(100);
                }
                if (!active()) return false;
                throw new Error('Spotify Connect has not released the LMS player; Randy did not replace its playback');
            } catch(error) { if (active()) this.set('disconnected');throw error; }
        } finally {
            if (this.preparing === sequence) this.preparing=null;
        }
    }

    async remoteControl(command) {
        if (!this.isConnectActive()) return false;
        const commands={next:['playlist','index','+1'],prev:['playlist','index','-1'],play:['play'],pause:['pause','1'],stop:['stop']};
        if (!commands[command]) return false;
        if (command === 'play') {
            const raw=await this.spotify.rpc(['status','-','1','tags:uNoTIHraldK']);
            if (!isConnect(raw) || raw.mode === 'stop') throw new Error('Start Spotify Connect from Spotify to establish a live session');
        }
        await this.spotify.rpc(commands[command]);return true;
    }
    publish(status, target, force=false) {
        const external=status.externalPlayback;
        if (!external || this.state === 'randy') return false;
        target.emit('spotify-ownership',{state:this.state,playbackState:external.state,trackKey:external.url,audioStalled:external.audioStalled});
        target.emit('pos',external.position);if(external.duration>0)target.emit('duration',external.duration);
        if(external.volume!=null)target.emit('volume',external.volume);
        if(typeof status.audioStats==='string')target.emit('audiostats',status.audioStats);
        const meta={title:external.title,artist:external.artist,albumName:external.album,album:[external.artist,external.album].filter(Boolean).join(' • '),albumart:external.artwork,source:'spotify_connect'};
        const key=JSON.stringify([meta,external.state]);
        if(force||key!==this.lastMetadata){this.lastMetadata=key;target.emit('nowplaying',meta);}
        return true;
    }
}
module.exports = {Ownership,isConnect};
