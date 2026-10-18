'use strict';

// Verified against SpotOn 3.5.8 Settings.pm and API/PKCE.pm. All credential
// creation, exchanges, invalidation and removal remain inside SpotOn.
const supportedVersion = '3.5.8';
const redirectUri = 'https://stiefenm.github.io/spoton/auth/';
const basicPath = '/plugins/SpotOn/settings/basic.html';
const prefix = '/plugins/SpotOn/settings/';
function failure(message) {return Object.assign(new Error(message),{spotifySettingsSafe:true});}
const ajax = {'X-Requested-With':'XMLHttpRequest'};

function invalidate(spotify) {
    spotify.statusCache=null;spotify.cache.clear();spotify.handles.clear();spotify.blockedUntil=0;
}
async function postSettings(spotify, fields) {
    const body=new URLSearchParams({saveSettings:'1',playerid:spotify.playerId,...fields});
    // These are written unconditionally by SpotOn's handler. Preserve them;
    // omit unrelated cookie/advanced fields so their handlers do not run.
    for (const name of ['bitrate','binary','normalization','diagnosticMode']) {
        const value=(await spotify.rpc(['pref','plugin.spoton:'+name,'?'],''))._p2;
        if (['normalization','diagnosticMode'].includes(name)) {
            if(Number(value)===1)body.set('pref_'+name,'1');
        } else if(value!=null)body.set('pref_'+name,String(value));
    }
    await spotify.request(basicPath,{method:'POST',headers:{...ajax,'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
    invalidate(spotify);
}
async function setClientId(spotify, value, remove=false) {
    if(typeof value!=='string' || (!remove && !/^[a-f0-9]{32}$/i.test(value.trim())) || (remove && value!==''))
        throw failure('Enter a Spotify Client ID: exactly 32 hexadecimal characters');
    value=value.trim();
    const previous=(await spotify.rpc(['pref','plugin.spoton:clientId','?'],''))._p2 || '';
    await postSettings(spotify,{pref_clientId:value});
    const saved=(await spotify.rpc(['pref','plugin.spoton:clientId','?'],''))._p2 || '';
    if(saved!==value)throw failure('SpotOn did not save the Client ID. Please retry.');
    return {success:true,reauthorizationRequired:previous!==value,redirectUri};
}
// fetch ignores Host on this Node runtime. Only PKCE start needs the browser's
// Randy host: SpotOn embeds it in its own state for the relay callback. Use the
// built-in HTTP client rather than rewriting OAuth state or changing the plugin.
function requestStart(spotify,path,options) {
    return new Promise((resolve,reject)=>{
        const url=new URL(path,spotify.base),http=require(url.protocol==='https:'?'node:https':'node:http');
        const req=http.request(url,{method:options.method,headers:{...options.headers,'Content-Length':Buffer.byteLength(options.body)}},response=>{
            let bytes=0,text='';response.setEncoding('utf8');
            response.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>65536)req.destroy(failure('SpotOn returned an invalid authorization response.'));else text+=chunk;});
            response.on('error',()=>reject(failure('LMS or SpotOn is unavailable. Please retry.')));
            response.on('end',()=>{
                if(response.statusCode!==200)return reject(failure('SpotOn could not start authorization. Please retry.'));
                resolve({json:async()=>JSON.parse(text)});
            });
        });
        req.setTimeout(8000,()=>req.destroy(failure('SpotOn authorization timed out. Please retry.')));
        req.on('error',()=>reject(failure('LMS or SpotOn is unavailable. Please retry.')));req.end(options.body);
    });
}
function authError(reason) {
    return ({unknown_account:'Set up your Spotify account first.',rate_limited:'Spotify is rate limited. Please try again later.',
        mismatch:'Please pair using the same Spotify account.',timeout:'Authorization timed out. Please retry.',
        no_binary:'Spotify pairing is unavailable. Try browser authorization.',
        no_capability:'Spotify pairing is unavailable. Try browser authorization.',
        spawn_failed:'Spotify pairing could not start. Try browser authorization.',
        account_mismatch:'Please pair using the same Spotify account.',
        invalid_credentials:'Spotify playback authorization failed. Please retry.',
        install_failed:'SpotOn could not save playback authorization. Please retry.',
        already_running:'Spotify pairing is already in progress.'})[reason] ||
        'Spotify authorization failed. Please retry.';
}
class SpotifySettings {
    constructor(spotify,options={}) {
        this.spotify=spotify;this.requestStart=options.requestStart || ((path,init)=>requestStart(spotify,path,init));this.now=options.now || Date.now;this.pending={};this.lastAuthorization={};this.serial=Promise.resolve();
    }
    mutate(operation) {
        const next=this.serial.then(operation);this.serial=next.catch(()=>{});return next;
    }
    async status(force=false) {
        const s=await this.spotify.status(force || !!this.pending.account || !!this.pending.playback);
        const supported=s.version===supportedVersion;
        const available=supported && !['unavailable','not-installed','error'].includes(s.state);
        const result={available,state:s.state,version:s.version || '',
            account:{connected:!!s.connected,present:!!s.hasAccount || !!s.connected || !!s.account,name:s.account || '',reconnectRequired:s.state==='auth-expired'},
            playback:{authorized:!!s.playbackAuthorized,pairing:'idle',browserFallback:available},
            clientId:{mode:s.clientIdMode==='personal'?'custom':'bundled',redirectUri:supported?redirectUri:''},
            includeInSearch:!!s.includeSearch};
        if(available && result.clientId.mode==='custom') {
            const value=(await this.spotify.rpc(['pref','plugin.spoton:clientId','?'],''))._p2;
            if(typeof value==='string' && /^[a-f0-9]{32}$/i.test(value))result.clientId.value=value;
        }
        if(s.version && !supported)result.state='unsupported';
        for(const kind of ['account','playback'])if(this.lastAuthorization[kind])result[kind].authorization=this.lastAuthorization[kind];
        for(const kind of ['account','playback']) {
            const pending=this.pending[kind];
            if(!pending)continue;
            if((kind==='account' && s.connected) || (kind==='playback' && s.playbackAuthorized)) {
                delete this.pending[kind];result[kind].authorization='success';
            } else if(this.now()>=pending.until) {
                delete this.pending[kind];result[kind].authorization='timeout';
                if(kind==='playback' && pending.pairing)await this.call('playerauth/cancel',{}).catch(()=>{});
            } else result[kind].authorization=pending.state || 'pending';
        }
        if(this.pending.playback?.pairing && available) {
            try {
                const raw=await (await this.spotify.request(prefix+'playerauth/status')).json();
                const state=['idle','waiting','success','mismatch','failed','timeout'].includes(raw.state)?raw.state:'failed';
                result.playback.pairing=state;
                if(['mismatch','failed','timeout','idle'].includes(state)) {
                    delete this.pending.playback;result.playback.authorization=state==='idle'?'cancelled':state;
                }
                // Pairing success alone never fabricates healthy playback credentials.
            } catch {result.playback.pairing='unavailable';}
        }
        return result;
    }
    async requireAvailable() {
        const status=await this.status(true);
        if(!status.available)throw failure(status.state==='not-installed'?'SpotOn is not installed.':status.state==='unsupported'?
            'This SpotOn version needs an updated Randy settings adapter.':'LMS or SpotOn is unavailable.');
        return status;
    }
    async activeAccount() {
        const [accounts,global,player]=await Promise.all([
            this.spotify.rpc(['pref','plugin.spoton:accounts','?'],''),this.spotify.rpc(['pref','plugin.spoton:activeAccount','?'],''),
            this.spotify.rpc(['playerpref','plugin.spoton:activeAccount','?'])]);
        const id=player._p2 || global._p2;
        if(!/^[0-9a-f]{8}$/.test(id || '') || !accounts._p2?.[id])throw failure('Set up your Spotify account first.');
        return id;
    }
    async call(path, fields, headers={}) {
        const options={method:'POST',headers:{...ajax,'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(fields).toString()};
        const response=await (headers.Host?this.requestStart(prefix+path,options):this.spotify.request(prefix+path,options));
        const value=await response.json();
        if(value.status==='error')throw failure(authError(value.reason));
        return value;
    }
    authURL(value) {
        const url=new URL(value.url);
        if(url.protocol!=='https:' || url.hostname!=='accounts.spotify.com' || url.pathname!=='/authorize' || url.username || url.password)
            throw failure('SpotOn returned an unexpected authorization address.');
        return url.href;
    }
    startAccount(origin) {return this.mutate(async()=>{
        await this.requireAvailable();
        const source=new URL(origin);
        const value=await this.call('pkce/start',{}, {Host:source.host,'X-Forwarded-Proto':source.protocol.slice(0,-1)});
        const url=this.authURL(value);
        delete this.lastAuthorization.account;
        this.pending.account={until:this.now()+180000,oauthState:new URL(url).searchParams.get('state')};
        return {url};
    });}
    async completeAccount(callbackURL) {
        if(typeof callbackURL!=='string' || callbackURL.length>12000)throw failure('Paste the Spotify return address.');
        let url;try{url=new URL(callbackURL);}catch{throw failure('Paste the complete Spotify return address.');}
        if(!url.searchParams.has('code') || !url.searchParams.has('state'))throw failure('The Spotify return address is missing authorization details.');
        if(!this.pending.account || this.now()>=this.pending.account.until || url.searchParams.get('state')!==this.pending.account.oauthState)
            throw failure('Authorization expired or was cancelled. Please retry.');
        try {
            const value=await this.call('pkce/manual',{callback_url:callbackURL});
            if(value.status!=='ok')throw failure('Spotify authorization failed. Please retry.');
            invalidate(this.spotify);delete this.pending.account;this.lastAuthorization.account='success';return {success:true};
        } catch(error) {delete this.pending.account;this.lastAuthorization.account='failed';throw error;}
    }
    cancelAccount() {delete this.pending.account;this.lastAuthorization.account='cancelled';return {success:true};}
    removeAccount(confirmed) {return this.mutate(async()=>{
        if(confirmed!==true)throw failure('Confirm account removal first.');
        await this.requireAvailable();const id=await this.activeAccount();
        await this.call('playerauth/cancel',{});
        await postSettings(this.spotify,{removeAccount:id});
        const accounts=(await this.spotify.rpc(['pref','plugin.spoton:accounts','?'],''))._p2 || {};
        if(accounts[id])throw failure('SpotOn did not remove the account. Please retry.');
        this.pending={};this.lastAuthorization={};this.spotify.accountsUnavailable=true;this.spotify.ownership?.cancelPending();this.spotify.ownership?.disconnected();
        return {success:true};
    });}
    startPlayback(browser=false) {return this.mutate(async()=>{
        const status=await this.requireAvailable();
        if(!status.account.connected)throw failure('Set up your Spotify account first.');
        const id=await this.activeAccount();
        if(browser)await this.call('playerauth/cancel',{});
        const value=await this.call(browser?'playerauth/browser/start':'playerauth/start',{accountId:id});
        const url=browser?this.authURL(value):null;
        delete this.lastAuthorization.playback;
        this.pending.playback={until:this.now()+180000,pairing:!browser,oauthState:browser?new URL(url).searchParams.get('state'):null};
        return browser?{url}:{success:true,deviceName:typeof value.deviceName==='string'?value.deviceName.slice(0,150):'SpotOn Authorization'};
    });}
    async completePlayback(callbackURL) {
        if(typeof callbackURL!=='string' || callbackURL.length>12000)throw failure('Paste the Spotify return address.');
        let url;try{url=new URL(callbackURL);}catch{throw failure('Paste the complete Spotify return address.');}
        if(!this.pending.playback || this.now()>=this.pending.playback.until || url.searchParams.get('state')!==this.pending.playback.oauthState)
            throw failure('Authorization expired or was cancelled. Please retry.');
        const value=await this.call('playerauth/browser/manual',{callback_url:callbackURL});
        if(value.status!=='ok')throw failure('Spotify playback authorization failed. Please retry.');
        delete this.pending.playback;invalidate(this.spotify);return {success:true};
    }
    async cancelPlayback() {await this.call('playerauth/cancel',{});delete this.pending.playback;this.lastAuthorization.playback='cancelled';return {success:true};}
    updateClientId(value,remove=false) {return this.mutate(async()=>{
        await this.requireAvailable();
        await this.call('playerauth/cancel',{});
        const result=await setClientId(this.spotify,value,remove);this.pending={};this.lastAuthorization={};return result;
    });}
}
module.exports={SpotifySettings,setClientId,redirectUri,supportedVersion};
