'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {Ownership}=require('../lib/spotify-ownership');const createPlayer=require('../lib/player');
const {setClientId}=require('../lib/spoton-settings');
const connect=(mode='play')=>({player_connected:1,mode,time:'12',duration:'200',playlist_tracks:1,'mixer volume':'42',playlist_loop:[{url:'spoton://connect-123',title:'Connect track',artist:'Artist',album:'Album',artwork_url:'https://i.scdn.co/image/cover',type:'ogg',bitrate:'320k'}]});
function fixture(){const calls=[];let raw=connect();const s={base:new URL('http://127.0.0.1:9000'),playerId:'player',
 request:async()=>({json:async()=>({daemons:[{mac:'player',alive:1,connectEnabled:1,streamPort:12345}]})}),
 fetch:async(url,options)=>{calls.push([url.pathname,options.method]);return {ok:true};},
 rpc:async command=>{calls.push(command);if(command[0]==='status')return raw;if(command[1]==='clear')raw={mode:'stop',playlist_tracks:'0',playlist_loop:[]};return {};}};
 const player={stop:async()=>calls.push(['adapter-stop']),getStatus:async()=>({connected:true})};
 const owner=new Ownership(s,{timeout:30,wait:async()=>{}});return {s,player,owner,calls,setRaw:v=>raw=v};}
test('normal Randy playback starts with Randy ownership',()=>{const f=fixture();assert.equal(f.owner.observe({playlist_loop:[{url:'file:///music/A.wav'}]}),null);assert.equal(f.owner.getOwnership(),'randy');});
test('Connect status is authoritative and normalizes numeric metadata',()=>{const f=fixture(),events=[];f.owner.on('change',e=>events.push(e));const status=f.owner.observe(connect());assert.equal(f.owner.getOwnership(),'spotify_connect');assert.equal(status.position,12);assert.equal(status.duration,200);assert.equal(status.volume,42);assert.equal(events.length,1);f.owner.observe(connect('pause'));assert.equal(events.length,1);});
for(const target of ['local','radio','spotify'])test('Connect -> Randy '+target+' confirms release before loading',async()=>{const f=fixture();f.owner.observe(connect());assert.equal(await f.owner.prepareForRandyPlayback(f.player),true);assert.equal(f.owner.getOwnership(),'randy');assert.deepEqual(f.calls.slice(0,3),[['adapter-stop'],['/control/pause','POST'],['playlist','clear']]);assert.equal(f.calls.at(-1)[0],'status');});
test('fresh Connect state is detected even before the regular player poll',async()=>{const f=fixture();assert.equal(await f.owner.prepareForRandyPlayback(f.player),true);assert.ok(f.calls.some(c=>c[0]==='adapter-stop'));});
test('manual replacement cancels a pending handoff',async()=>{const f=fixture();f.owner.observe(connect());let active=true;f.player.stop=async()=>{active=false;};assert.equal(await f.owner.prepareForRandyPlayback(f.player,()=>active),false);assert.equal(f.calls.length,0);});
test('manual pause cancels pending automatic handoff',async()=>{const f=fixture();f.owner.observe(connect());f.player.stop=async()=>f.owner.cancelPending();assert.equal(await f.owner.prepareForRandyPlayback(f.player),false);assert.equal(f.owner.getOwnership(),'spotify_connect');});
test('failed Connect pause refuses to replace LMS playback',async()=>{const f=fixture();f.owner.observe(connect());f.s.fetch=async()=>({ok:false});await assert.rejects(f.owner.prepareForRandyPlayback(f.player),/acknowledge/);assert.equal(f.calls.some(c=>c[1]==='clear'),false);assert.equal(f.owner.getOwnership(),'disconnected');});
test('Connect stop never automatically resumes Randy',()=>{const f=fixture();f.owner.observe(connect());const result=f.owner.observe(connect('stop'));assert.equal(result.state,'stopped');assert.equal(f.owner.getOwnership(),'spotify_connect');assert.equal(f.calls.length,0);});
test('Connect next/previous operate on SpotOn, not Randy queue',async()=>{const f=fixture();f.owner.observe(connect());await f.owner.remoteControl('next');await f.owner.remoteControl('prev');assert.deepEqual(f.calls,[['playlist','index','+1'],['playlist','index','-1']]);});
test('external metadata is displayed without assigning a Randy queue index',()=>{const f=fixture();const external=f.owner.observe(connect()),events=[];f.owner.publish({externalPlayback:external,audioStats:'OGG 320kbps'},{emit:(name,data)=>events.push({name,data})});const meta=events.find(e=>e.name==='nowplaying').data;assert.equal(meta.source,'spotify_connect');assert.equal(meta.title,'Connect track');assert.equal(events.some(e=>e.name==='playlist'),false);});
test('same Connect track republishes artwork and details immediately after a Randy handoff',async()=>{
 const f=fixture(),events=[],target={emit:(name,data)=>events.push({name,data})};
 const publish=()=>f.owner.publish({externalPlayback:f.owner.external},target);
 f.owner.observe(connect());publish();publish();assert.equal(events.filter(e=>e.name==='nowplaying').length,1);
 await f.owner.prepareForRandyPlayback(f.player);
 f.owner.observe({playlist_loop:[{url:'file:///music/A.wav'}]});
 f.owner.observe(connect());publish();
 assert.equal(events.filter(e=>e.name==='nowplaying').length,2);
 assert.equal(events.findLast(e=>e.name==='nowplaying').data.albumart,'/spotify/artwork?url=https%3A%2F%2Fi.scdn.co%2Fimage%2Fcover');
});
test('resuming Connect republishes unchanged metadata without waiting for a new song',()=>{
 const f=fixture(),events=[],target={emit:(name,data)=>events.push({name,data})};
 for(const mode of ['pause','play']){f.owner.observe(connect(mode));f.owner.publish({externalPlayback:f.owner.external},target);}
 assert.equal(events.filter(e=>e.name==='nowplaying').length,2);
});
for(const before of ['/music/A.wav','spoton://track:3M0zi8iD2KRzY71XcGFUpE'])test('Connect takeover cancels '+before+' and stale retry without stop/replacement',async t=>{
 const calls=[];let raw={player_connected:1,mode:'stop',playlist_tracks:1,time:0,duration:60,'mixer volume':42,can_seek:1,playlist_loop:[{url:'file:///music/A.wav'}]};
 const owner=fixture().owner;
 const player=createPlayer({backend:'lms',playerId:'player',pollInterval:60000,observeExternalPlayback:r=>owner.observe(r)},{fetch:async(url,options)=>{const command=JSON.parse(options.body).params[1];calls.push(command);if(command[0]==='players')return {ok:true,json:async()=>({result:{count:1,players_loop:[{playerid:'player',connected:1}]}})};if(command[1]==='play')raw={...raw,mode:'play',playlist_loop:[{url:command[2].startsWith('/')?'file://'+command[2]:command[2]}]};return {ok:true,json:async()=>({result:command[0]==='status'?raw:{}})};}});
 t.after(()=>player.close());const ended=[];player.on('ended',e=>ended.push(e));await player.loadAndPlay({songfile:before},{playbackId:1});
 raw=connect();player.current.pending=true;const count=calls.length;await player._poll();assert.equal(player.current,null);assert.equal((await player.getStatus()).playbackId,null);assert.equal(owner.getOwnership(),'spotify_connect');
 await player._poll();assert.equal(calls.slice(count).some(c=>c[0]!=='status'),false);assert.equal(ended.length,0);
 raw=connect('stop');await player._poll();assert.equal(player.current,null);assert.equal(ended.length,0);
});
const client='0123456789abcdef0123456789abcdef';
function settingsFixture(){const calls=[],prefs={bitrate:160,binary:'helper',normalization:0,diagnosticMode:1};let saved='';
 const spotify={base:new URL('http://127.0.0.1:9000'),playerId:'player',cache:new Map(),handles:new Map(),
 request:async(path,options)=>{calls.push({path,options});if(options){const form=new URLSearchParams(options.body);saved=form.get('pref_clientId');return {ok:true};}return {text:async()=>'<form action="/plugins/SpotOn/settings/basic.html"><input name="saveSettings" value="1"><input name="pref_clientId"><input name="pref_spDc" value="SECRET_COOKIE"><input name="access_token" value="SECRET_TOKEN"></form>'};},
 rpc:async c=>({_p2:c[1].endsWith(':clientId')?saved:prefs[c[1].split(':')[1]]})};return {spotify,calls};}
test('personal Client ID is saved in SpotOn, preserves public prefs and excludes credentials',async()=>{const f=settingsFixture();const result=await setClientId(f.spotify,client);const post=f.calls.find(c=>c.options);assert.equal(post.path.includes(client),false);assert.doesNotMatch(post.options.body,/SECRET|spDc|access_token|password|secret/);const form=new URLSearchParams(post.options.body);assert.equal(form.get('pref_bitrate'),'160');assert.equal(form.has('pref_normalization'),false);assert.equal(form.get('pref_diagnosticMode'),'1');assert.equal(result.reauthorizationRequired,true);assert.doesNotMatch(JSON.stringify(result),new RegExp(client));});
for(const invalid of ['', 'bad', 'z'.repeat(32), client+'; command'])test('invalid Client ID is rejected before any LMS write: '+invalid,async()=>{const f=settingsFixture();await assert.rejects(setClientId(f.spotify,invalid),/32 hexadecimal/);assert.equal(f.calls.length,0);});
test('Client ID setup fails safely when SpotOn is unavailable',async()=>{const f=settingsFixture();f.spotify.request=async()=>{throw new Error('LMS unavailable');};await assert.rejects(setClientId(f.spotify,client),/LMS unavailable/);});
test('Client ID save uses a fixed SpotOn handler without reading rendered HTML',async()=>{const f=settingsFixture();await setClientId(f.spotify,client);assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/plugins/SpotOn/settings/basic.html');assert.equal(f.calls[0].options.headers['X-Requested-With'],'XMLHttpRequest');});


test('dead Connect helper does not prevent Randy from reclaiming an idle LMS player',async()=>{const f=fixture();f.owner.observe(connect());f.s.request=async()=>({json:async()=>({daemons:[]})});assert.equal(await f.owner.prepareForRandyPlayback(f.player),true);assert.equal(f.owner.getOwnership(),'randy');});
test('silent Connect buffering is diagnosed without resuming or advancing Randy',()=>{const f=fixture();const raw=connect();raw.time=0;f.owner.observe(raw);f.owner.progress.at=f.owner.now()-26000;const result=f.owner.observe(raw);assert.equal(result.audioStalled,true);assert.equal(f.calls.length,0);assert.equal(f.owner.getOwnership(),'spotify_connect');});

test('ordinary Randy ownership recovers after LMS outage so natural EOF remains enabled',()=>{const f=fixture();f.owner.disconnected();assert.equal(f.owner.getOwnership(),'disconnected');f.owner.observe({playlist_loop:[{url:'file:///music/A.wav'}]});assert.equal(f.owner.getOwnership(),'randy');});

test('LMS Browse replay of Connect history is not mistaken for a live Connect session',()=>{const f=fixture();f.owner.observe(connect());const raw=connect();raw.playlist_loop[0].type='PCM, SpotOn Browse';assert.equal(f.owner.observe(raw),null);assert.equal(f.owner.getOwnership(),'disconnected');assert.equal(f.owner.connectHistory,true);});
test('stopped Connect history cannot be resumed through LMS Play as though it were live',async()=>{const f=fixture();f.owner.observe(connect());f.setRaw(connect('stop'));await assert.rejects(f.owner.remoteControl('play'),/establish a live session/);assert.equal(f.calls.some(c=>c[0]==='play'),false);});

test('late first Connect observation does not cancel an explicit Randy handoff already being prepared',async()=>{const f=fixture(),states=[];f.owner.on('change',e=>states.push(e.state));f.player.getStatus=async()=>{f.owner.observe(connect());return {connected:true};};assert.equal(await f.owner.prepareForRandyPlayback(f.player),true);assert.equal(states.includes('spotify_connect'),false);assert.equal(f.owner.getOwnership(),'randy');});

test('Connect to Randy refreshes helper only after LMS queue release and before permitting load',async()=>{
 const f=fixture();let recovered=false;
 f.s.recovery={recover:async(current,options)=>{
   assert.equal(current(),true);assert.equal(options.reason,'handoff');
   assert.ok(f.calls.some(c=>c[0]==='playlist'&&c[1]==='clear'));
   assert.equal(f.owner.getOwnership(),'transitioning');recovered=true;
 }};
 f.owner.observe(connect());assert.equal(await f.owner.prepareForRandyPlayback(f.player),true);
 assert.equal(recovered,true);assert.equal(f.owner.getOwnership(),'randy');
});
test('ordinary local selection does not refresh the Spotify helper',async()=>{
 const f=fixture();f.setRaw({mode:'play',playlist_tracks:1,playlist_loop:[{url:'file:///music/local.flac'}]});
 f.s.recovery={recover:async()=>assert.fail('unexpected helper restart')};
 assert.equal(await f.owner.prepareForRandyPlayback(f.player),true);
});
test('replacement during handoff refresh cancels the old playback request',async()=>{
 const f=fixture();let selected=true;
 f.s.recovery={recover:async()=>{selected=false;return true;}};
 f.owner.observe(connect());assert.equal(await f.owner.prepareForRandyPlayback(f.player,()=>selected),false);
});
test('failed handoff refresh never permits loading into a half-reset session',async()=>{
 const f=fixture();f.s.recovery={recover:async()=>{throw new Error('helper restart failed');}};
 f.owner.observe(connect());await assert.rejects(f.owner.prepareForRandyPlayback(f.player),/helper restart failed/);
 assert.equal(f.owner.getOwnership(),'disconnected');
});

test('local/radio handoff permits loading before helper refresh starts',async()=>{
 const f=fixture(),calls=[];let release;
 f.s.recovery={recover:()=>{calls.push('refresh');return new Promise(r=>release=r);}};
 f.owner.observe(connect());assert.equal(await f.owner.prepareForRandyPlayback(f.player,()=>true,{deferConnectReset:true}),true);
 assert.deepEqual(calls,[]);assert.equal(f.owner.getOwnership(),'randy');
 f.owner.afterRandyPlaybackStarted(()=>true);assert.deepEqual(calls,['refresh']);
 release(true);await new Promise(setImmediate);assert.equal(f.owner.needsConnectRefresh,false);
});
test('ordinary local changes do not wait for a helper refresh already in progress',async()=>{
 const f=fixture();f.s.recovery={pending:new Promise(()=>{})};
 f.setRaw({mode:'play',playlist_loop:[{url:'file:///local.wav'}]});
 assert.equal(await f.owner.prepareForRandyPlayback(f.player,()=>true,{deferConnectReset:true}),true);
});

test('removed account cannot republish stale Connect metadata or artwork',()=>{
 const f=fixture();f.owner.observe(connect());const old=f.owner.external;
 f.s.accountsUnavailable=true;
 assert.equal(f.owner.observe(connect()),null);assert.equal(f.owner.getOwnership(),'disconnected');
 assert.equal(f.owner.publish({externalPlayback:old},{emit:()=>assert.fail('stale account metadata')}),false);
});
