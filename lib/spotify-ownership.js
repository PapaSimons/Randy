'use strict';
const {EventEmitter} = require('node:events');
const media = require('./spotify-item');
const isConnect = raw => /^spoton:\/\/connect-/.test(raw?.playlist_loop?.[0]?.url || '') && !/SpotOn Browse/i.test(raw?.playlist_loop?.[0]?.type || '');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
class Ownership extends EventEmitter {
    constructor(spotify, options = {}) {
        super(); this.spotify = spotify; this.state = 'randy'; this.external = null;
        this.transition = 0; this.timeout = options.timeout || 7000; this.wait = options.wait || delay;
        this.now=options.now || Date.now;this.stallTimeout=options.stallTimeout ?? 25000;
    }
    set(state) { if (this.state !== state) {const previous=this.state;this.state=state;this.lastMetadata=null;this.spotify.log?.('ownership',{previous,state});this.emit('change',{state,previous});} }
    getOwnership() { return this.state; }
    isConnectActive() { return this.state === 'spotify_connect' || (this.state === 'transitioning' && !!this.external); }
    observe(raw) {
        if(this.spotify.accountsUnavailable && isConnect(raw)) {
            this.external=null;this.progress=null;this.set('disconnected');return null;
        }
        const url = raw.playlist_loop?.[0]?.url;
        if (!isConnect(raw)) {
            this.progress=null;
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
        const position=numeric(raw.time),now=this.now();
        if(raw.mode !== 'play' || position == null) this.progress=null;
        else if(!this.progress || this.progress.url!==url || this.progress.position!==position)
            this.progress={url,position,at:now};
        this.external={source:'spotify_connect',url,title:track.title || raw.current_title || 'Spotify Connect',artist:track.artist || '',album:track.album || '',
            artwork:media.artwork(track.artwork_url),seekable:Number(raw.can_seek)===1,position:numeric(raw.time),duration:numeric(raw.duration),volume:numeric(raw['mixer volume']),
            audioStalled:!!this.progress && now-this.progress.at>=this.stallTimeout,
            state:({play:'playing',pause:'paused',stop:'stopped'})[raw.mode] || 'stopped'};
        const playbackKey=JSON.stringify([url,this.external.state,this.external.audioStalled]);
        if(playbackKey !== this.lastConnectLog) {
            this.lastConnectLog=playbackKey;
            this.spotify.log?.(this.external.audioStalled ? 'connect-stalled' : 'connect-playback',
                {playback:this.external.state,stalled:this.external.audioStalled});
        }
        if (this.state !== 'transitioning') this.set(this.preparing === this.transition ? 'transitioning' : 'spotify_connect');
        if(this.external.audioStalled && this.state==='spotify_connect' && this.spotify.recovery) {
            const sequence=this.transition,progress=this.progress;
            this.spotify.recovery.recover(()=>this.state==='spotify_connect' && this.transition===sequence && this.progress===progress && !!this.external?.audioStalled)
                .catch(()=>{}); // Recovery logs a sanitized error; adapter polling stays alive.
        }
        return this.external;
    }
    cancelPending() {
        ++this.transition;
        if (this.state === 'transitioning') this.set(this.external ? 'spotify_connect' : 'disconnected');
    }
    disconnected() { if (this.state !== 'transitioning') this.set('disconnected'); }
    async prepareForRandyPlayback(player, current = () => true, options = {}) {
        const sequence=++this.transition;
        const active=()=>sequence===this.transition&&current();
        this.preparing=sequence;
        this.spotify.log?.('randy-playback-request',{state:this.state});
        try {
            if(this.spotify.recovery?.pending && !options.deferConnectReset) {
                try {await this.spotify.recovery.pending;}catch {}
                if(!active())return false;
            }
            if (!this.isConnectActive() && !this.external) {
                const status=await player.getStatus();
                if (!active()) return false;
                if (!status.connected) {this.set('randy');return true;}
                let raw;
                try {raw=await this.spotify.rpc(['status','-','1','tags:uNoTIHraldK']);}
                catch {return active();} // The adapter retains normal infrastructure retries.
                if (!active()) return false;
                if (!isConnect(raw)) {
                    if(this.needsConnectRefresh && !options.deferConnectReset && this.spotify.recovery) {
                        await player.stop();if(!active())return false;
                        await this.spotify.rpc(['playlist','clear']);if(!active())return false;
                        await this.spotify.recovery.recover(active,{reason:'handoff'});if(!active())return false;
                        this.needsConnectRefresh=false;
                    }
                    this.set('randy');return true;
                }
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
                        this.releasedURL=this.external?.url;
                        if(this.spotify.recovery) {
                            this.needsConnectRefresh=true;
                            this.refreshGeneration=(this.refreshGeneration || 0)+1;
                            if(!options.deferConnectReset) {
                                await this.spotify.recovery.recover(active,{reason:'handoff'});
                                if(!active())return false;
                                this.needsConnectRefresh=false;
                            }
                        }
                        this.external=null;this.progress=null;this.set('randy');return true;
                    }
                    await this.wait(100);
                }
                if (!active()) return false;
                throw new Error('Spotify Connect has not released the LMS player; Randy did not replace its playback');
            } catch(error) {
                this.spotify.log?.('handoff-error',{category:require('./spotify-log').category(error)});
                if (active()) this.set('disconnected');throw error;
            }
        } finally {
            if (this.preparing === sequence) this.preparing=null;
        }
    }

    afterRandyPlaybackStarted(current) {
        if(!this.needsConnectRefresh || !this.spotify.recovery || !current())return;
        // Local/radio audio bypasses SpotOn; the helper can be refreshed alongside it.
        const active=()=>current() && this.state==='randy';
        const generation=this.refreshGeneration,waiting=!!this.spotify.recovery.pending;
        this.spotify.recovery.recover(active,{reason:'handoff',alongsidePlayback:true})
            .then(refreshed=>{
                if(refreshed && generation===this.refreshGeneration)this.needsConnectRefresh=false;
                else if(waiting && active())this.afterRandyPlaybackStarted(current);
            })
            .catch(()=>{}); // Sanitized recovery diagnostics are already logged.
    }

    async remoteControl(command) {
        if (!this.isConnectActive()) return false;
        const commands={next:['playlist','index','+1'],prev:['playlist','index','-1'],play:['play'],pause:['pause','1'],stop:['stop']};
        if (!commands[command]) return false;
        this.spotify.log?.('connect-control',{command});
        if (command === 'play') {
            const raw=await this.spotify.rpc(['status','-','1','tags:uNoTIHraldK']);
            if (!isConnect(raw) || raw.mode === 'stop') throw new Error('Start Spotify Connect from Spotify to establish a live session');
        }
        await this.spotify.rpc(commands[command]);return true;
    }
    publish(status, target, force=false) {
        const external=status.externalPlayback;
        if (!external || this.state === 'randy' || this.spotify.accountsUnavailable) return false;
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
