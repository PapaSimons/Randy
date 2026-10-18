'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SpotifySettings,redirectUri}=require('../lib/spoton-settings');
const register=require('../lib/spotify-settings-routes');
function fixture() {
    let now=0;
    const prefs={accounts:{'1234abcd':{displayName:'Listener',access_token:'SECRET'}},activeAccount:'1234abcd',clientId:'',bitrate:160,binary:'helper',normalization:0,diagnosticMode:1};
    const state={version:'3.5.8',state:'connected',connected:true,hasAccount:true,account:'Listener',playbackAuthorized:true,clientIdMode:'shared',includeSearch:true,access_token:'SECRET'};
    const calls=[],settings={},s={playerId:'player',base:new URL('http://localhost:9000'),cache:new Map(),handles:new Map(),
        ownership:{cancelPending(){},disconnected(){}},status:async()=>({...state}),
        rpc:async c=>{calls.push(c);return {_p2:prefs[c[1].split(':')[1]]};},
        request:async(path,options)=>{
            calls.push({path,options});
            const body=new URLSearchParams(options?.body);
            if(path.endsWith('basic.html')) {
                if(body.has('pref_clientId')){prefs.clientId=body.get('pref_clientId');state.connected=false;state.clientIdMode=prefs.clientId?'personal':'shared';}
                if(body.has('removeAccount')){delete prefs.accounts[body.get('removeAccount')];state.connected=false;state.account='';state.hasAccount=false;state.playbackAuthorized=false;}
                return {};
            }
            return {json:async()=>path.endsWith('/status')?{state:'waiting',accountId:'1234abcd',credentials:'SECRET'}:
                {status:'ok',deviceName:'SpotOn Authorization',url:'https://accounts.spotify.com/authorize?state=NONCE',nonce:'SECRET',access_token:'SECRET'}};
        }};
    const controller=new SpotifySettings(s,{now:()=>now,requestStart:(path,options)=>s.request(path,options)});
    return {s,controller,state,prefs,calls,settings,tick:ms=>now+=ms};
}
test('native status explicitly sanitizes credentials, internal IDs and Client ID values',async()=>{
 const f=fixture(),status=await f.controller.status();assert.equal(status.account.name,'Listener');assert.equal(status.account.connected,true);
 assert.equal(status.playback.authorized,true);assert.equal(status.clientId.mode,'bundled');
 assert.doesNotMatch(JSON.stringify(status),/SECRET|access_token|refresh_token|password|1234abcd|credentials/);
});
for(const state of ['not-connected','auth-expired','unavailable','not-installed'])test('native status: '+state,async()=>{
 const f=fixture();Object.assign(f.state,{state,connected:false,playbackAuthorized:false});
 if(['unavailable','not-installed'].includes(state))delete f.state.version;
 const s=await f.controller.status();assert.equal(s.account.connected,false);assert.equal(s.playback.authorized,false);
 assert.equal(s.available,!['unavailable','not-installed'].includes(state));assert.equal(s.account.reconnectRequired,state==='auth-expired');
});
test('unknown plugin versions disable mutations instead of assuming a settings contract',async()=>{
 const f=fixture();f.state.version='4.0.0';await assert.rejects(f.controller.startAccount('http://randy.local'),/updated Randy/);
 assert.equal(f.calls.length,0);
});
test('account authorization starts through SpotOn PKCE, embeds Randy callback host and returns no nonce',async()=>{
 const f=fixture();f.state.connected=false;const result=await f.controller.startAccount('http://randy.local:3000');
 assert.match(result.url,/^https:\/\/accounts.spotify.com\/authorize/);assert.deepEqual(Object.keys(result),['url']);
 const call=f.calls.find(c=>c.path?.endsWith('pkce/start'));assert.equal(call.options.headers.Host,'randy.local:3000');
 assert.equal(call.options.headers['X-Requested-With'],'XMLHttpRequest');
 assert.equal((await f.controller.status()).account.authorization,'pending');f.state.connected=true;
 assert.equal((await f.controller.status()).account.authorization,'success');
});
test('account authorization timeout and cancellation leave credentials in SpotOn',async()=>{
 const f=fixture();f.state.connected=false;await f.controller.startAccount('http://randy.local');f.tick(180001);
 assert.equal((await f.controller.status()).account.authorization,'timeout');
 await f.controller.startAccount('http://randy.local');f.controller.cancelAccount();assert.equal(f.controller.pending.account,undefined);
 assert.ok(f.prefs.accounts['1234abcd']);
});
test('PKCE completion forwards callback only to SpotOn manual handler and strips its response',async()=>{
 const f=fixture();await f.controller.startAccount('http://randy.local');const response=await f.controller.completeAccount('http://randy.local/plugins/SpotOn/settings/pkce/callback?code=CODE&state=NONCE');
 assert.deepEqual(response,{success:true});assert.doesNotMatch(JSON.stringify(response),/SECRET|1234abcd|token/);
 const call=f.calls.find(c=>c.path?.endsWith('pkce/manual'));assert.equal(new URLSearchParams(call.options.body).get('callback_url').includes('code=CODE'),true);
});
test('account removal needs confirmation and uses SpotOn cleanup, preserving unrelated settings',async()=>{
 const f=fixture();await assert.rejects(f.controller.removeAccount(false),/Confirm/);assert.equal(f.calls.length,0);
 await f.controller.removeAccount(true);assert.equal(f.prefs.accounts['1234abcd'],undefined);
 const call=f.calls.find(c=>c.path?.endsWith('basic.html')),body=new URLSearchParams(call.options.body);
 assert.equal(body.get('removeAccount'),'1234abcd');assert.equal(body.get('pref_bitrate'),'160');assert.equal(body.get('pref_diagnosticMode'),'1');
 assert.equal(body.has('pref_clientId'),false);assert.doesNotMatch(call.options.body,/SECRET|spDc|refresh_token/);
});
test('account removal failure is detected',async()=>{
 const f=fixture(),request=f.s.request;f.s.request=(path,o)=>path.endsWith('basic.html')?Promise.resolve({}):request(path,o);
 await assert.rejects(f.controller.removeAccount(true),/did not remove/);
});
test('playback authorization uses real SpotOn pairing and filters pairing account ID',async()=>{
 const f=fixture();f.state.playbackAuthorized=false;const result=await f.controller.startPlayback();
 assert.equal(result.deviceName,'SpotOn Authorization');const status=await f.controller.status();assert.equal(status.playback.pairing,'waiting');
 assert.equal(status.playback.authorized,false);assert.doesNotMatch(JSON.stringify(status),/1234abcd|SECRET/);
 f.state.playbackAuthorized=true;assert.equal((await f.controller.status()).playback.authorization,'success');
});
test('browser playback fallback delegates to SpotOn and never returns credential blobs',async()=>{
 const f=fixture();const start=await f.controller.startPlayback(true);assert.deepEqual(Object.keys(start),['url']);
 const result=await f.controller.completePlayback('http://127.0.0.1:18764/login?code=CODE&state=NONCE');assert.deepEqual(result,{success:true});
 assert.ok(f.calls.some(c=>c.path?.endsWith('playerauth/browser/manual')));
});
test('playback pairing failure and unavailable LMS produce useful errors',async()=>{
 const f=fixture();f.s.request=async()=>({json:async()=>({status:'error',reason:'unknown_account',access_token:'SECRET'})});
 await assert.rejects(f.controller.startPlayback(),/Set up your Spotify account/);
 const other=fixture();other.state.state='unavailable';other.state.version=undefined;
 await assert.rejects(other.controller.startPlayback(),/unavailable/);
});
for (const reason of ['no_binary','no_capability','spawn_failed']) {
 test(`SpotOn ${reason} offers browser pairing fallback`,async()=>{
  const f=fixture();f.s.request=async()=>({json:async()=>({status:'error',reason})});
  await assert.rejects(f.controller.startPlayback(),/browser authorization/);
 });
}
test('Client ID save/remove call existing SpotOn settings handler and report reauthorization',async()=>{
 const f=fixture();const id='0123456789abcdef0123456789abcdef';
 assert.equal((await f.controller.updateClientId(id)).reauthorizationRequired,true);
 assert.equal((await f.controller.status()).clientId.mode,'custom');assert.equal(f.prefs.clientId,id);
 assert.equal((await f.controller.status()).account.connected,false);
 assert.equal((await f.controller.updateClientId('',true)).reauthorizationRequired,true);assert.equal(f.prefs.clientId,'');
 assert.equal((await f.controller.status()).clientId.mode,'bundled');assert.equal((await f.controller.status()).clientId.redirectUri,redirectUri);
});
test('invalid Client ID is rejected and settings failure does not pretend success',async()=>{
 const f=fixture();await assert.rejects(f.controller.updateClientId('bad'),/32 hexadecimal/);
 f.s.request=async()=>{throw new Error('fetch failed');};await assert.rejects(f.controller.updateClientId('0123456789abcdef0123456789abcdef'),/fetch failed/);
});
function routeFixture(f=fixture()) {
 const routes={},settings={};const controller=register({post:(p,h)=>routes[p]=h,get:(p,h)=>routes[p]=h},{spotify:f.s,playlist:{setSetting:(k,v)=>settings[k]=v}});
 controller.requestStart=(path,options)=>f.s.request(path,options);
 async function invoke(path,body={},headers={}) {
  let status=200,value;const response={set(){return this;},status(n){status=n;return this;},json(v){value=v;},type(){return this;},send(v){value=v;}};
  await routes[path]({protocol:'http',body,query:{},get:name=>({'host':'randy.local','X-Requested-With':'XMLHttpRequest',...headers})[name]},response);
  return {status,value};
 }return {invoke,settings};
}
test('Randy search preference is stored independently from SpotOn and does not disconnect it',async()=>{
 const f=fixture(),r=routeFixture(f);await r.invoke('/spotify/settings/search',{enabled:false});assert.equal(r.settings.spotifySearchEnabled,false);
 assert.equal(f.calls.length,0);assert.equal(f.state.connected,true);await r.invoke('/spotify/settings/search',{enabled:true});assert.equal(r.settings.spotifySearchEnabled,true);
});
test('native routes reject cross-origin mutation and sanitize upstream parser failures',async()=>{
 const f=fixture(),r=routeFixture(f);
 assert.equal((await r.invoke('/spotify/settings/account/start',{}, {origin:'http://evil.example'})).status,403);
 f.s.request=async()=>{throw new SyntaxError('SECRET_REFRESH_TOKEN');};
 const result=await r.invoke('/spotify/settings/account/start');assert.equal(result.status,400);assert.doesNotMatch(JSON.stringify(result),/SECRET/);
});
function uiFixture() {
 const elements=new Map();
 function $(query){if(typeof query==='function')return; if(!elements.has(query))elements.set(query,{value:'',props:{},attrs:{},text(v){this.label=v;return this;},prop(k,v){this.props[k]=v;return this;},attr(k,v){this.attrs[k]=v;return this;}});return elements.get(query);}
 const context=vm.createContext({$,window:{},document:{},AbortSignal,clearTimeout,setTimeout,Date});
 vm.runInContext(fs.readFileSync(require.resolve('../public/JS/spotify-settings.js'),'utf8'),context);
 return {ui:context.spotifySettingsUI,elements};
}
for(const connected of [true,false])test('native account/playback UI: '+connected,()=>{
 const f=uiFixture();f.ui.render({available:true,state:connected?'connected':'not-connected',account:{connected,present:connected,name:'Listener'},playback:{authorized:connected,browserFallback:true},clientId:{mode:'bundled'},includeInSearch:connected});
 assert.equal(f.elements.get('#spotify-account-state').label,connected?'✓':'Not connected');
 assert.equal(f.elements.get('#spotify-playback-state').label,connected?'Enabled ✓':'Requires Spotify Account');
 assert.equal(f.elements.get('#spotify-account-remove').props.hidden,!connected);
});
test('native UI keeps account and playback health separate and supports custom Client ID state',()=>{
 const f=uiFixture();f.ui.render({available:true,state:'connected',account:{connected:true,present:true,name:'Listener'},playback:{authorized:false,browserFallback:true},clientId:{mode:'custom'},includeInSearch:false});
 assert.equal(f.elements.get('#spotify-playback-state').label,'Not enabled');assert.equal(f.elements.get('#spotify-playback-start').props.disabled,false);
 assert.equal(f.elements.get('#spotify-client-toggle').label,'Change');
 assert.equal(f.elements.get('#spotify-client-mode').label,'✓');assert.equal(f.elements.get('#spotify-client-remove').props.hidden,false);
 assert.equal(f.elements.get('#spotify-search-enabled').props.checked,false);
});

test('unchecked search preference suppresses frontend Spotify search requests entirely',async()=>{
 const requests=[],timers=[],chain={empty(){return this;},on(){return this;}};
 const $=query=>typeof query==='function'?undefined:chain;
 const context=vm.createContext({$,document:{addEventListener(){}},AbortSignal,AbortController,
  fetch:async(path)=>{requests.push(path);return {ok:true,json:async()=>({connected:true,includeSearch:false})};},
  setTimeout:callback=>timers.push(callback),clearTimeout(){}});
 vm.runInContext(fs.readFileSync(require.resolve('../public/JS/spotify.js'),'utf8'),context);
 await context.spotifyUI.refresh();context.spotifyUI.search('Air');assert.deepEqual(requests,['/spotify/status']);assert.equal(timers.length,0);
});
test('unknown fields in upstream account/playback completion replies never reach Randy UI',async()=>{
 const f=fixture(),r=routeFixture(f);await r.invoke('/spotify/settings/account/start');const result=await r.invoke('/spotify/settings/account/complete',{callbackURL:'http://localhost/login?code=CODE&state=NONCE'});
 assert.equal(result.status,200);assert.deepEqual(result.value,{success:true});assert.doesNotMatch(JSON.stringify(result),/SECRET|token|nonce|accountId|CODE/);
});

test('cancelled or mismatched account authorization cannot be completed through Randy',async()=>{
 const f=fixture();f.state.connected=false;await f.controller.startAccount('http://randy.local');
 await assert.rejects(f.controller.completeAccount('http://localhost/login?code=CODE&state=OTHER'),/expired or was cancelled/);
 f.controller.cancelAccount();await assert.rejects(f.controller.completeAccount('http://localhost/login?code=CODE&state=NONCE'),/expired or was cancelled/);
 assert.equal(f.calls.filter(c=>c.path?.endsWith('pkce/manual')).length,0);
});
test('expired playback-browser authorization is not forwarded to SpotOn',async()=>{
 const f=fixture();await f.controller.startPlayback(true);f.tick(180001);
 await assert.rejects(f.controller.completePlayback('http://localhost/login?code=CODE&state=NONCE'),/expired or was cancelled/);
 assert.equal(f.calls.filter(c=>c.path?.endsWith('browser/manual')).length,0);
});

for(const state of ['unavailable','not-installed','auth-expired'])test('native UI handles '+state+' without conflating playback and account health',()=>{
 const f=uiFixture(),available=state==='auth-expired';
 f.ui.render({available,state,account:{connected:false,present:available,reconnectRequired:available},playback:{authorized:false},clientId:{mode:'bundled'},includeInSearch:false});
 assert.equal(f.elements.get('#spotify-account-state').label,available?'Spotify needs to reconnect':'Unavailable');
 assert.equal(f.elements.get('#spotify-playback-start').props.disabled,true);
});
test('cancelled authorization state remains visible to the initiating frontend poll',async()=>{
 const f=fixture();f.state.connected=false;await f.controller.startAccount('http://randy.local');f.controller.cancelAccount();
 assert.equal((await f.controller.status()).account.authorization,'cancelled');
});
test('failed account exchange produces a failed state without exposing upstream error payloads',async()=>{
 const f=fixture();f.state.connected=false;await f.controller.startAccount('http://randy.local');
 const request=f.s.request;f.s.request=(path,options)=>path.endsWith('pkce/manual')?Promise.resolve({json:async()=>({status:'error',reason:'unknown',access_token:'SECRET'})}):request(path,options);
 await assert.rejects(f.controller.completeAccount('http://localhost/login?code=CODE&state=NONCE'),/authorization failed/);
 const status=await f.controller.status();assert.equal(status.account.authorization,'failed');assert.doesNotMatch(JSON.stringify(status),/SECRET/);
});

test('custom Client ID is displayed from SpotOn while credentials remain sanitized',async()=>{
 const f=fixture();f.state.clientIdMode='personal';f.prefs.clientId='0123456789abcdef0123456789abcdef';
 const status=await f.controller.status();assert.equal(status.clientId.value,f.prefs.clientId);
 assert.doesNotMatch(JSON.stringify(status),/SECRET|access_token|refresh_token/);
 const ui=uiFixture();ui.ui.render(status);assert.equal(ui.elements.get('#spotify-client-value').label,f.prefs.clientId);

});
test('Spotify settings use right-hand controls, inline setup and pairing instructions without browser fallback',()=>{
 const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
 assert.match(html,/spotify-setting-controls/);assert.match(html,/id="spotify-client-toggle"[^>]*aria-expanded="false"/);
 assert.match(html,/id="spotify-client-settings" hidden/);assert.match(html,/Reset to default/);
 assert.match(html,/Start playing any track/);assert.match(html,/id="spotify-pairing-device"/);
 assert.doesNotMatch(html,/id="spotify-playback-browser"|id="spotify-playback-fallback"/);
});

test('account removal confirmation uses Randy wording',()=>{
 const source=fs.readFileSync(require.resolve('../public/JS/spotify-settings.js'),'utf8');
 assert.match(source,/Remove your Spotify account from Randy\?/);
 assert.doesNotMatch(source,/Remove the active Spotify account from SpotOn/);
});

test('account name is separate from the connected tick',()=>{
 const f=uiFixture();f.ui.render({available:true,account:{connected:true,present:true,name:'Listener'},playback:{authorized:true},clientId:{mode:'bundled'}});
 assert.equal(f.elements.get('#spotify-account-name').label,'Listener');
 assert.equal(f.elements.get('#spotify-account-name').props.hidden,false);
 assert.equal(f.elements.get('#spotify-account-state').label,'✓');
});
