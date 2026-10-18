'use strict';
const cheerio = require('cheerio');
const {isConnect} = require('./spotify-ownership');
const {category} = require('./spotify-log');
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));

// SpotOn has no restart RPC. Its supported player settings handler restarts
// this player's helper when enableSpotifyConnect changes. Never restart LMS.
class ConnectRecovery {
    constructor(spotify, options={}) {
        this.spotify=spotify;this.now=options.now || Date.now;this.wait=options.wait || delay;
        this.cooldown=options.cooldown ?? 300000;this.timeout=options.timeout ?? 15000;
        this.pending=null;this.lastAttempt=-Infinity;
    }
    recover(current, options={}) {
        if(this.pending)return this.pending;
        if(!current() || (options.reason !== 'handoff' && this.now()-this.lastAttempt<this.cooldown))return Promise.resolve(false);
        this.lastAttempt=this.now();
        this.pending=this.restart(current,options).finally(()=>{this.pending=null;});
        return this.pending;
    }
    async daemon(enabled) {
        const deadline=this.now()+this.timeout;
        while(this.now()<deadline) {
            const data=await (await this.spotify.request('/plugins/SpotOn/status/data')).json();
            const daemon=data.daemons?.find(d=>String(d.mac).toLowerCase()===this.spotify.playerId.toLowerCase());
            if(daemon?.alive && !!Number(daemon.connectEnabled)===enabled)return true;
            await this.wait(300);
        }
        throw new Error('SpotOn Connect restart timed out');
    }
    async restart(current, options={}) {
        const spotify=this.spotify;
        try {
            const raw=await spotify.rpc(['status','-','1','tags:u']);
            if(!current())return false;
            if(options.reason === 'handoff') {
                // Intentional ownership boundary, only after pause/clear is confirmed.
                const url=raw.playlist_loop?.[0]?.url || '';
                const independent=options.alongsidePlayback && !isConnect(raw) &&
                    (/^(?:https?:|file:)/i.test(url) || url.startsWith('/'));
                if(!independent && (raw.mode !== 'stop' || Number(raw.playlist_tracks)!==0))
                    throw new Error('LMS player is not released for Connect restart');
            } else if(!isConnect(raw) || raw.mode!=='play')return false;
            const path='/plugins/SpotOn/settings/player.html';
            const response=await spotify.request(path+'?playerid='+encodeURIComponent(spotify.playerId));
            const $=cheerio.load(await response.text());
            const toggle=$('input[name="pref_enableSpotifyConnect"]'),form=toggle.closest('form');
            if(toggle.length!==1 || form.length!==1 || !toggle.is(':checked'))return false;
            const action=new URL(form.attr('action') || path,spotify.base);
            if(action.origin!==spotify.base.origin || action.pathname!==path)throw new Error('Unexpected SpotOn player settings form');
            const body=new URLSearchParams();
            for(const name of ['saveSettings','useAJAX','page','playerid','player']) {
                const field=form.find('input[name="'+name+'"]');
                if(field.length)body.set(name,field.attr('value') || '');
            }
            body.set('saveSettings','1');body.set('playerid',spotify.playerId);
            for(const name of ['enableDiscovery','enableAutoplay']) {
                const field=form.find('input[name="pref_'+name+'"]');
                if(field.is(':checked'))body.set('pref_'+name,'1');
            }
            for(const name of ['streamFormat','connectOggOverride','streamingMode','bitrateOverride']) {
                const field=form.find('[name="pref_'+name+'"]');
                if(field.length)body.set('pref_'+name,String(field.val() ?? ''));
            }
            if(!current())return false;
            const post=()=>spotify.request(action.pathname+action.search,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
            spotify.log?.('connect-restart',{state:'starting',operation:options.reason === 'handoff' ? 'handoff' : 'stall'});
            // Always restore Connect, including cancellation or a lost POST response.
            try {await post();await this.daemon(false);}
            finally {
                body.set('pref_enableSpotifyConnect','1');
                try {await post();}catch {await post();}
            }
            await this.daemon(true);
            spotify.statusCache=null;
            spotify.log?.('connect-restart',{state:'ready'});
            return true;
        } catch(error) {
            spotify.log?.('connect-restart-error',{category:category(error)});
            throw error;
        }
    }
}
module.exports={ConnectRecovery};
