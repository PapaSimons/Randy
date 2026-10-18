'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ConnectRecovery}=require('../lib/spotify-recovery');
const {Ownership}=require('../lib/spotify-ownership');
const raw=(mode='play',time=0,url='spoton://connect-test')=>({mode,time,playlist_loop:[{url}]});
function fixture() {
    let now=0,enabled=true,status=raw(),posts=[],events=[];
    const html=`<form action="/plugins/SpotOn/settings/player.html"><input name="playerid" value="player">
        <input name="pref_enableSpotifyConnect" type="checkbox" checked>
        <input name="pref_enableDiscovery" type="checkbox" checked><input name="pref_enableAutoplay" type="checkbox">
        <select name="pref_streamFormat"><option selected>pcm</option></select>
        <select name="pref_streamingMode"><option selected>global</option></select>
        <select name="pref_bitrateOverride"><option selected>160</option></select></form>`;
    const spotify={base:new URL('http://localhost:9000'),playerId:'player',log:(...event)=>events.push(event),
        rpc:async()=>status,request:async(path,options)=>{
            if(path.includes('/status/data'))return {json:async()=>({daemons:[{mac:'player',alive:1,connectEnabled:enabled?1:0}]})};
            if(options){const body=new URLSearchParams(options.body);posts.push(body);enabled=body.has('pref_enableSpotifyConnect');return {};}
            return {text:async()=>html};
        }};
    const recovery=new ConnectRecovery(spotify,{now:()=>now,wait:async ms=>{now+=ms;},timeout:1000});spotify.recovery=recovery;
    return {spotify,recovery,posts,events,setStatus:s=>status=s,tick:ms=>now+=ms,now:()=>now};
}
test('recovery restarts only configured Connect helper via supported form and preserves PCM/discovery/bitrate',async()=>{
    const f=fixture();assert.equal(await f.recovery.recover(()=>true),true);
    assert.equal(f.posts.length,2);assert.equal(f.posts[0].has('pref_enableSpotifyConnect'),false);
    assert.equal(f.posts[1].get('pref_enableSpotifyConnect'),'1');
    for(const body of f.posts){assert.equal(body.get('pref_streamFormat'),'pcm');assert.equal(body.get('pref_bitrateOverride'),'160');assert.equal(body.get('pref_enableDiscovery'),'1');assert.equal(body.has('pref_enableAutoplay'),false);}
    assert.equal(f.recovery.pending,null);
});
test('recovery has a five minute cooldown and concurrent requests share one operation',async()=>{
    const f=fixture(),first=f.recovery.recover(()=>true),second=f.recovery.recover(()=>true);
    assert.equal(first,second);await first;assert.equal(await f.recovery.recover(()=>true),false);assert.equal(f.posts.length,2);
    f.tick(300001);await f.recovery.recover(()=>true);assert.equal(f.posts.length,4);
});
for(const status of [raw('pause'),raw('stop'),raw('play',5,'/local.flac'),raw('play',5,'https://radio.example/live')])
    test('recovery never restarts paused/stopped/local/radio playback: '+status.playlist_loop[0].url+' '+status.mode,async()=>{
        const f=fixture();f.setStatus(status);assert.equal(await f.recovery.recover(()=>true),false);assert.equal(f.posts.length,0);
    });
test('stale/cancelled recovery request cannot write player settings',async()=>{
    const f=fixture();let current=true;f.spotify.rpc=async()=>{current=false;return raw();};
    assert.equal(await f.recovery.recover(()=>current),false);assert.equal(f.posts.length,0);
});
test('failed disable response still restores Connect',async()=>{
    const f=fixture(),request=f.spotify.request;let first=true;
    f.spotify.request=async(path,options)=>{const result=await request(path,options);if(options && first){first=false;throw new Error('fetch failed');}return result;};
    await assert.rejects(f.recovery.recover(()=>true),/fetch failed/);
    assert.equal(f.posts.length,2);assert.equal(f.posts[1].get('pref_enableSpotifyConnect'),'1');
    assert.equal(f.events.at(-1)[0],'connect-restart-error');
});
test('cancel after disable still restores Connect and Randy waits for pending recovery',async()=>{
    const f=fixture(),request=f.spotify.request;let current=true;
    f.spotify.request=async(path,options)=>{const result=await request(path,options);if(options)current=false;return result;};
    await f.recovery.recover(()=>current);assert.equal(f.posts[1].get('pref_enableSpotifyConnect'),'1');
    let release,read=false;f.spotify.recovery.pending=new Promise(r=>release=r);
    const owner=new Ownership(f.spotify);const result=owner.prepareForRandyPlayback({getStatus:async()=>{read=true;return {connected:false};}});
    await Promise.resolve();assert.equal(read,false);release();await result;assert.equal(read,true);
});
test('only a persistently motionless playing Connect track triggers recovery; moving and paused tracks do not',async()=>{
    const f=fixture(),owner=new Ownership(f.spotify,{now:f.now});let recoveries=0;
    f.spotify.recovery={recover:async current=>{if(current())recoveries++;}};
    owner.observe(raw());f.tick(24000);owner.observe(raw());assert.equal(recoveries,0);
    f.tick(1001);owner.observe(raw());assert.equal(recoveries,1);
    owner.observe(raw('play',1));assert.equal(owner.external.audioStalled,false);
    f.tick(30000);owner.observe(raw('pause',1));assert.equal(recoveries,1);
});
test('new Connect track resets stall timer',()=>{
    const f=fixture(),owner=new Ownership(f.spotify,{now:f.now});owner.observe(raw());f.tick(30000);
    owner.observe(raw('play',0,'spoton://connect-new'));assert.equal(owner.external.audioStalled,false);
});

test('handoff restarts after release even if a recent stall attempt used the cooldown',async()=>{
    const f=fixture();await f.recovery.recover(()=>true);
    f.setStatus({mode:'stop',playlist_tracks:'0',playlist_loop:[]});
    assert.equal(await f.recovery.recover(()=>true,{reason:'handoff'}),true);assert.equal(f.posts.length,4);
});
test('handoff refuses a restart while a local or Connect item is still loaded',async()=>{
    const f=fixture();await assert.rejects(f.recovery.recover(()=>true,{reason:'handoff'}),/not released/);
    assert.equal(f.posts.length,0);
});

for(const url of ['/music/track.flac','file:///music/track.flac','https://radio.example/live'])
test('handoff refresh can run alongside independent local/radio playback: '+url,async()=>{
 const f=fixture();f.setStatus(raw('play',10,url));
 assert.equal(await f.recovery.recover(()=>true,{reason:'handoff',alongsidePlayback:true}),true);
 assert.equal(f.posts.length,2);
});
test('background refresh cannot interrupt a Randy Spotify item or live Connect session',async()=>{
 for(const url of ['spoton://track:123','spotify:track:123','spoton://connect-test']) {
  const f=fixture();f.setStatus(raw('play',10,url));
  await assert.rejects(f.recovery.recover(()=>true,{reason:'handoff',alongsidePlayback:true}),/not released/);assert.equal(f.posts.length,0);
 }
});
