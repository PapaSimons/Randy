'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const createSpotify = require('../lib/spotify');
const media = require('../lib/spotify-item');
const register = require('../lib/spotify-routes');
const uri = 'spoton://track:3M0zi8iD2KRzY71XcGFUpE';
const art = 'https://i.scdn.co/image/example';
const song = () => media.song({songfile:uri,albumart:art,tags:{common:{title:'Track',artist:'Artist',album:'Album'},format:{duration:155.6}}});
const nav = id => ({cmd:['spoton','items'],params:{item_id:id}});
const item = (kind, id = '3M0zi8iD2KRzY71XcGFUpE') => ({text:kind === 'track' ? 'Track\nArtist • Album' : kind+'\nArtist (2026)',
    icon:art, presetParams:{favorites_url:kind === 'artist' ? '' : 'spoton://'+kind+':'+id,icon:art},params:{item_id:kind},duration:'155.6'});
function fixture(options = {}) {
    const calls=[], settings={...options.settings};
    const health={system:{pluginVersion:'3.5.8'},authHealth:{id:{pkce:{hasToken:1,needsReauth:0},playback:{hasCredentials:1,needsAuth:0}}},api:{rateLimited:0}};
    let handler;
    const client=createSpotify({playerId:'player',getSettings:()=>settings,setSetting:(k,v)=>settings[k]=v,
        fetch:async(url, init)=>{
            assert.equal(url.origin,'http://127.0.0.1:9000');
            const command=init.body ? JSON.parse(init.body).params[1] : null;
            calls.push(command || url.pathname);
            if(handler) {const reply=await handler(url,init,command);if(reply)return reply;}
            let result;
            if(url.pathname==='/plugins/SpotOn/status/data') return {ok:true,json:async()=>health};
            if(command[0]==='pref' || command[0]==='playerpref') result={_p2:command[1].endsWith(':accounts') ? {id:{displayName:'Listener',token:'DO_NOT_EXPOSE'}} : 'id'};
            else {
                const id=command.find(c=>c.startsWith('item_id:'))?.slice(8);
                if(!id)result={item_loop:[{icon:'plugins/SpotOn/html/images/search.png',actions:{go:nav('search')}}]};
                else if(id==='search')result={item_loop:[{type:'search',actions:{go:nav('input')}}]};
                else if(id==='input')result={item_loop:['track','album','artist','playlist'].map(kind=>({icon:'/icons/'+(kind==='track'?'song':kind)+'.png',actions:{go:nav(kind+'s')}}))};
                else if(id.endsWith('s'))result={item_loop:[item(id.slice(0,-1))],count:1};
                else result={item_loop:[item('track')],count:1};
            }
            return {ok:true,json:async()=>({result})};
        }});
    return {client,calls,settings,health,handler:fn=>handler=fn};
}
for(const state of ['connected','not-connected','auth-expired','not-installed','unavailable','error']) test('settings state: '+state,async()=>{
    const f=fixture();
    if(state==='not-connected') f.health.authHealth.id.pkce.hasToken=0;
    if(state==='connecting') f.health.authHealth.id.playback.hasCredentials=0;
    if(state==='auth-expired') f.health.authHealth.id.pkce.needsReauth='1';
    if(state==='not-installed') f.handler(async()=>({ok:false,status:404}));
    if(state==='unavailable') f.handler(async()=>{throw new TypeError('fetch failed');});
    if(state==='error') f.handler(async()=>({ok:true,json:async()=>{throw new SyntaxError('HTML');}}));
    const status=await f.client.status();assert.equal(status.state,state);
    assert.equal(status.connected,state==='connected');assert.equal(status.includeSearch,state==='connected');
    assert.doesNotMatch(JSON.stringify(status),/DO_NOT_EXPOSE|hasToken|refresh_token|access_token/);
});
test('connected status normalizes numeric strings and persists default search setting',async()=>{
    const f=fixture();Object.assign(f.health.authHealth.id.pkce,{hasToken:'1',needsReauth:'0'});Object.assign(f.health.authHealth.id.playback,{hasCredentials:'1',needsAuth:'0'});
    assert.equal((await f.client.status()).includeSearch,true);assert.equal(f.settings.spotifySearchEnabled,true);
});
for(const enabled of [true,false,'false']) test('search preference: '+enabled,async()=>{
    const f=fixture({settings:{spotifySearchEnabled:enabled}});const r=await f.client.search('Air');
    assert.equal(r.tracks.length,enabled===true?1:0);
    if(enabled!==true) assert.equal(f.calls.filter(c=>Array.isArray(c)&&c[0]==='spoton').length,0);
});
test('federated service returns all four types and caches identical searches',async()=>{
    const f=fixture();const a=await f.client.search('Air');
    for(const kind of ['track','album','artist','playlist']) {assert.equal(a[kind+'s'].length,1);assert.equal(a[kind+'s'][0].kind,kind);}
    assert.equal(a.tracks[0].song.songfile,uri);assert.equal(a.tracks[0].song.tags.common.album,'Album');
    assert.equal(a.albums[0].year,'2026');assert.ok(a.artists[0].key);assert.equal(a.artists[0].uri,'');
    const count=f.calls.length;await f.client.search('Air');assert.equal(f.calls.length,count);
    assert.equal(f.calls.filter(c=>Array.isArray(c)&&c[0]==='spoton').every(c=>c[1]==='items'),true);
});
test('Spotify search failure is bounded, returns empty groups, backs off',async()=>{
    const f=fixture();f.handler(async(u,o,c)=>{if(c?.[0]==='spoton')throw new Error('timeout');});
    const r=await f.client.search('Air');assert.equal(r.tracks.length,0);assert.match(r.message,/unavailable/);
    const count=f.calls.length;await f.client.search('Other');assert.equal(f.calls.length,count);
});
test('reported rate limit avoids querying SpotOn',async()=>{
    const f=fixture();f.health.api.rateLimited=1;const r=await f.client.search('Air');assert.match(r.message,/rate limit/);
    assert.equal(f.calls.filter(c=>Array.isArray(c)&&c[0]==='spoton').length,0);
});
for(const kind of ['album','playlist','artist'])test(kind+' browse follows server-issued read-only handle',async()=>{
    const f=fixture();const found=await f.client.search('Air');const result=await f.client.browse(found[kind+'s'][0].key,true);
    assert.equal(result.items[0].song.songfile,uri);assert.equal(result.total,1);
    await assert.rejects(f.client.browse('invented'),/expired/);
});
test('pagination expands collections completely without starting LMS playback',async()=>{
    const f=fixture();const album=(await f.client.search('Air')).albums[0];
    f.handler(async(u,o,c)=>c?.includes('item_id:album')?{ok:true,json:async()=>({result:{count:'101',item_loop:Array.from({length:c[2]==='0'?100:1},()=>item('track'))}})}:null);
    const result=await f.client.browse(album.key,true);assert.equal(result.items.length,101);assert.equal(result.hasMore,false);
    assert.equal(f.calls.filter(c=>Array.isArray(c)&&c[0]==='spoton').every(c=>c[1]==='items'),true);
});
test('album resolution rejects a different URI rather than importing the wrong album',async()=>{
    const f=fixture();const album=(await f.client.search('Air')).albums[0];
    f.handler(async(u,o,c)=>c?.includes('item_id:albums')&&c[3]==='1'?{ok:true,json:async()=>({result:{item_loop:[item('album','2BtE7qm1qzM80p9vLSiXkj')]}})}:null);
    const result=await f.client.browse(album.key,true);
    assert.equal(result.enumerable,false);assert.equal(result.items.length,0);assert.match(result.message,/Randy couldn't open this one\. Try it in Spotify\./);
});
test('album leaf metadata supplies original title, duration, artist, artwork and parent identity',async()=>{
    const f=fixture();const album=(await f.client.search('Air')).albums[0];
    f.handler(async(u,o,c)=>{
        if(c?.includes('item_id:album'))return {ok:true,json:async()=>({result:{count:1,item_loop:[{...item('track'),params:{item_id:'album.0'}}]}})};
        if(c?.includes('item_id:album.0'))return {ok:true,json:async()=>({result:{loop_loop:[{url:uri,title:'Original title',artist:'Actual artist',album:'Actual album',duration:'170.106',image:art}]}})};
    });
    const result=await f.client.browse(album.key,true);const track=result.items[0].song;
    assert.equal(result.enumerable,true);assert.equal(track.tags.common.title,'Original title');assert.equal(track.tags.common.artist,'Actual artist');
    assert.equal(track.tags.format.duration,170.106);assert.equal(track.parentUri,album.uri);assert.equal(track.albumart,media.artwork(art));
});
test('stale leaf metadata cannot replace a different Spotify track',async()=>{
    const f=fixture();const album=(await f.client.search('Air')).albums[0];
    f.handler(async(u,o,c)=>{
        if(c?.includes('item_id:album'))return {ok:true,json:async()=>({result:{count:1,item_loop:[{...item('track'),params:{item_id:'album.0'}}]}})};
        if(c?.includes('item_id:album.0'))return {ok:true,json:async()=>({result:{loop_loop:[{url:'spoton://track:2EqlS6tkEnglzr7tkKAAYD',title:'Wrong cover'}]}})};
    });
    await assert.rejects(f.client.browse(album.key,true),/browse changed/);
});
test('blocked playlist preserves its metadata but exposes no queue actions',async()=>{
    const f=fixture();const playlist=(await f.client.search('Air')).playlists[0];
    f.handler(async(u,o,c)=>c?.includes('item_id:playlist')?{ok:true,json:async()=>({result:{count:0,item_loop:[{type:'text',text:'No results'}]}})}:null);
    const result=await f.client.browse(playlist.key,true);
    assert.equal(result.title,playlist.title);assert.equal(result.uri,playlist.uri);assert.equal(result.enumerable,false);assert.match(result.message,/restricted/);
});
test('owned playlist resolves through Library when Spotify search rank differs',async()=>{
    const f=fixture();const playlist=(await f.client.search('Air')).playlists[0];
    f.handler(async(u,o,c)=>{
        if(c?.includes('item_id:playlists'))return {ok:true,json:async()=>({result:{item_loop:[item('playlist','2CKnioFobYQRK3EEMf9Jr6')]}})};
        if(c?.[0]==='spoton'&&!c.some(x=>x.startsWith('item_id:')))return {ok:true,json:async()=>({result:{item_loop:[{icon:'plugins/SpotOn/html/images/search.png',actions:{go:nav('search')}},{icon:'html/images/musicfolder.png',actions:{go:nav('library')}}]}})};
        if(c?.includes('item_id:library'))return {ok:true,json:async()=>({result:{item_loop:[{icon:'html/images/playlists.png',actions:{go:nav('owned')}}]}})};
        if(c?.includes('item_id:owned'))return {ok:true,json:async()=>({result:{count:1,item_loop:[{...item('playlist'),params:{item_id:'owned.0'}}]}})};
        if(c?.includes('item_id:owned.0'))return {ok:true,json:async()=>({result:{count:1,item_loop:[item('track')]}})};
    });
    const result=await f.client.browse(playlist.key,true);
    assert.equal(result.enumerable,true);assert.equal(result.items[0].song.parentUri,playlist.uri);
    assert.ok(f.calls.some(c=>c?.includes?.('item_id:owned.0')));
});
test('container identity is preserved but arbitrary parent URLs are not persisted',()=>{
    const parentUri='spoton://album:2BtE7qm1qzM80p9vLSiXkj';
    assert.equal(media.song({...song(),parentUri}).parentUri,parentUri);
    assert.equal(media.song({...song(),parentUri:'https://temporary.example/token'}).parentUri,undefined);
});
test('account/auth changes invalidate cached searches and browse handles',async()=>{
    const f=fixture();const key=(await f.client.search('Air')).albums[0].key;
    f.health.authHealth.id.pkce.needsReauth=1;await f.client.status(true);assert.equal(f.client.handles.has(key),false);
});
test('menu navigation never forwards playback commands',()=>{
    const f=fixture();assert.equal(f.client.params({actions:{go:{cmd:['playlist','play'],params:{item_id:'bad'}}}}),null);
});
for(const value of [art,'/imageproxy/'+encodeURIComponent(art)+'/image_300x300_o'])test('artwork proxy accepts public source: '+value,()=>{
    assert.equal(media.artwork(value),'/spotify/artwork?url='+encodeURIComponent(art));
});
for(const value of ['', 'http://127.0.0.1/secret','https://evil.example/a','https://i.scdn.co.evil.example/a','https://user:password@i.scdn.co/a'])test('missing/unsafe artwork fallback: '+value,()=>assert.equal(media.artwork(value),'/IMG/Record.png'));
test('artwork strips query credentials and songs whitelist metadata',()=>{
    const s=media.song({...song(),albumart:art+'?access_token=SECRET',password:'SECRET',tags:{...song().tags,token:'SECRET'}});
    assert.equal(s.albumart,media.artwork(art));assert.doesNotMatch(JSON.stringify(s),/SECRET|token|password/);
});
for(const bad of ['spoton://album:3M0zi8iD2KRzY71XcGFUpE','spoton://connect-123','https://stream.example/temporary','spotify:track:invalid'])test('reject non-track Spotify queue identifier: '+bad,()=>assert.throws(()=>media.song({songfile:bad}),/individual/));
function routes(f=fixture(),backend='lms') {
    const handlers={},calls=[];
    const playlist={setSetting:(k,v)=>f.settings[k]=v,queueSpotify:(items,mode)=>{calls.push({items,mode});return items[0];},addtosticky:async s=>calls.push({sticky:s})};
    register({post:(p,h)=>handlers[p]=h,get:(p,h)=>handlers[p]=h},{spotify:f.client,playlist,backend,playSong:async s=>calls.push({play:s})});
    const invoke=async(p,body={})=>{let code=200,value;const res={status:n=>{code=n;return res;},json:v=>value=v};await handlers[p]({body},res);return {code,value};};
    return {invoke,calls,f};
}
for(const action of ['play','add','sticky'])test('track '+action+' uses existing Randy queue operations',async()=>{
    const r=routes();const response=await r.invoke('/spotify/queue',{action,song:song()});assert.equal(response.code,200);
    if(action==='sticky')assert.equal(r.calls[0].sticky.songfile,uri);
    else {assert.equal(r.calls[0].mode,action==='play'?'insert':'append');assert.equal(r.calls.filter(c=>c.play).length,action==='play'?1:0);}
});
for(const kind of ['album','playlist'])for(const action of ['play','add'])test(kind+' '+action+' expands into individual Randy items',async()=>{
    const r=routes();const key=(await r.f.client.search('Air'))[kind+'s'][0].key;
    const response=await r.invoke('/spotify/queue',{action,key});assert.equal(response.code,200);assert.equal(r.calls[0].mode,action==='play'?'replace':'append');
    assert.equal(r.calls[0].items[0].songfile,uri);
});
test('empty collection does not mutate Randy queue',async()=>{
    const r=routes();const key=(await r.f.client.search('Air')).albums[0].key;
    r.f.handler(async(u,o,c)=>c?.includes('item_id:album')?{ok:true,json:async()=>({result:{count:0,item_loop:[]}})}:null);
    assert.equal((await r.invoke('/spotify/queue',{action:'play',key})).code,400);assert.equal(r.calls.length,0);
});
test('MPV selection rejects Spotify playback without altering queue',async()=>{
    const r=routes(fixture(),'mpv');assert.equal((await r.invoke('/spotify/queue',{action:'play',song:song()})).code,400);assert.equal(r.calls.length,0);
});
test('authentication expiry returns useful message without changing queue',async()=>{
    const f=fixture();f.health.authHealth.id.pkce.needsReauth=1;const r=routes(f);
    assert.match((await r.invoke('/spotify/queue',{action:'play',song:song()})).value.error,/needs to reconnect/);assert.equal(r.calls.length,0);
});
test('settings connect/manage URLs target SpotOn and have no tokens',async()=>{
    const r=routes();const value=(await r.invoke('/spotify/status')).value;
    assert.match(value.authUrl,/plugins\/SpotOn\/settings\/basic.html/);assert.equal(value.canDisconnect,false);
    assert.doesNotMatch(JSON.stringify(value),/DO_NOT_EXPOSE|password|access_token|refresh_token/);
    await r.invoke('/spotify/preference',{enabled:false});assert.equal(r.f.settings.spotifySearchEnabled,false);
    assert.equal((await r.invoke('/spotify/preference',{enabled:'false'})).code,400);
});

function playlistFixture() {
    const db={pdb:{playlist:[{type:'file',songfile:'/local.wav',tags:{common:{title:'Local'},format:{duration:60}}}]},sdb:{status:{playing:0,volume:35}},ldb:{stickylist:[]},odb:{settings:{musicfolders:null}}};
    function DB(file){this.data=db[path.basename(file,'.json')]||{};this.has=k=>k in this.data;this.get=k=>this.data[k];this.set=(k,v)=>this.data[k]=v;}
    const modules={'simple-json-db':DB,'smart-observe':()=>{},'./spotify-item':media};
    const context=vm.createContext({module:{exports:{}},__dirname:path.resolve(__dirname,'../lib'),console:{log(){}},Buffer,URL,
        require:name=>name in modules?modules[name]:require(name==='./radio-url-finder.js'?'../lib/radio-url-finder':name)});
    vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../lib/playlist_utils.js'),'utf8'),context);
    return context.module.exports;
}
test('actual Randy playlist preserves next/previous, local items, Spotify metadata and stickies',async()=>{
    const p=playlistFixture();await p.initPlaylist(()=>{},()=>{},()=>{});
    p.queueSpotify([song(),song()],'append');assert.equal(p.getPlayList().length,3);assert.equal(p.getPlaying(),0);
    assert.equal(p.nextsong().songfile,uri);assert.equal(p.prevsong().songfile,'/local.wav');
    await p.addtosticky(song());await p.addtosticky(song());assert.equal(p.getStickyList().length,1);
    assert.equal(p.getStickyList()[0].path.songfile,uri);assert.equal(p.getStickyList()[0].path.albumart,media.artwork(art));
    await p.addandplay(p.getStickyList()[0].path);assert.equal(p.getCurrentSong().type,'spotify');
    await p.removesticky(song());assert.equal(p.getStickyList().length,0);
});
test('queue validation is atomic and albums replace while playlists append',async()=>{
    const p=playlistFixture();await p.initPlaylist(()=>{},()=>{},()=>{});
    assert.throws(()=>p.queueSpotify([song(),{songfile:'bad'}],'replace'));assert.equal(p.getPlayList().length,1);
    p.queueSpotify([song(),song()],'replace');assert.equal(p.getPlayList().length,2);assert.equal(p.getPlaying(),0);
    p.queueSpotify([song(),song()],'append');assert.equal(p.getPlayList().length,4);assert.equal(p.getPlaying(),0);
});

test('browser search debounce and stale-response protection leave only the newest results', async()=>{
    const pending=[],timers=[],rendered=[];
    const chain={empty(){rendered.length=0;return this;},append(value){rendered.push(value);return this;},text(value){this.label=value;return this;},on(){return this;},attr(){return this;}};
    const $=value=>typeof value==='function'?undefined:value==='#spotify-search-results'?chain:{...chain};
    const context=vm.createContext({$,document:{addEventListener(){}},AbortController,AbortSignal,window:{},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},
        fetch:(url,options)=>url==='/spotify/status'?Promise.resolve({ok:true,json:async()=>({connected:true,includeSearch:true})}):new Promise(resolve=>pending.push({url,options,resolve})),setInterval(){}});
    vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../public/JS/spotify.js'),'utf8'),context);
    await context.spotifyUI.refresh();
    context.spotifyUI.invalidate();context.spotifyUI.search('old');assert.equal(pending.length,0);timers.shift()();
    context.spotifyUI.invalidate();context.spotifyUI.search('new');timers.shift()();
    const groups=label=>({results:{tracks:[],albums:[],artists:[],playlists:[],message:label}});
    pending[1].resolve({ok:true,json:async()=>groups('new')});await new Promise(setImmediate);
    const count=rendered.length;
    pending[0].resolve({ok:true,json:async()=>({results:{tracks:[],albums:[],artists:[],playlists:[{title:'STALE'}]}})});await new Promise(setImmediate);
    assert.equal(rendered.length,count);assert.equal(pending[0].options.signal.aborted,true);
});
test('Connect notice has a Spotify icon, second-line track, deduplicated updates and clears on takeover',()=>{
    const base=require('cheerio').load('<div id="spotify-connect-toast"></div><div id="songlist"></div>');
    const $=query=>typeof query==='function' ? undefined : base(query);
    const context=vm.createContext({$,document:{addEventListener(){}},randyUI:{icon:()=>'<svg class="randy-icon"></svg>'}});
    vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../public/JS/spotify.js'),'utf8'),context);
    const ui=context.spotifyUI,toast=$('#spotify-connect-toast');
    ui.setOwnership({state:'spotify_connect',trackKey:'A',playbackState:'playing'});
    ui.updateNowPlaying({source:'spotify_connect',title:'First',artist:'Artist',albumName:'Album'});
    assert.equal(toast.prop('hidden'),false);assert.equal(toast.find('svg').length,1);
    assert.equal(toast.find('.connect-toast-heading').text(),'Spotify Connect');
    assert.equal(toast.find('.connect-toast-track').text(),'First');
    assert.equal(toast.find('.connect-toast-track').attr('title'),'First');
    assert.equal(toast.find('.connect-toast-album').text(),'Album - Artist');
    const node=toast.find('.connect-toast-track')[0];
    ui.setOwnership({state:'spotify_connect',trackKey:'A',playbackState:'playing'});assert.equal(toast.find('.connect-toast-track')[0],node);
    ui.setOwnership({state:'spotify_connect',trackKey:'B',playbackState:'playing'});assert.equal(toast.find('.connect-toast-track').text(),'');
    ui.updateNowPlaying({source:'spotify_connect',title:'<Second>',artist:'Other'});
    assert.equal(toast.find('.connect-toast-track').text(),'<Second>');
    assert.equal(toast.find('.connect-toast-album').text(),'Other');assert.equal(toast.find('second').length,0);
    ui.setOwnership({state:'spotify_connect',playbackState:'stopped'});assert.equal(toast.prop('hidden'),true);assert.equal(toast.text(),'');
    ui.setOwnership({state:'randy'});ui.updateNowPlaying({source:'spotify_connect',title:'STALE'});assert.equal(toast.text(),'');
    ui.setOwnership({state:'disconnected'});assert.equal(toast.prop('hidden'),true);
});

test('real seek-dial callback sends finite Spotify positions and stays inside EOF',()=>{
    let options,start,length='155.6';const sent=[];
    const context=vm.createContext({$:selector=>({knob:value=>options=value,bind:(name,callback)=>start=callback}),
        cursong:{find:()=>({attr:()=>length})},socket:{emit:(...args)=>sent.push(args)},seekbarreleased:true,console:{log(){}}});
    const source=fs.readFileSync(path.resolve(__dirname,'../public/JS/main.js'),'utf8');
    vm.runInContext(source.slice(source.indexOf('//knob//'),source.indexOf('function changemf')),context);
    start();options.release(50);assert.deepEqual(sent[0],['seek',78]);
    start();options.release(100);assert.ok(sent[1][1]<155.6&&sent[1][1]>155);
    for(const value of ['',undefined,'bad']){length=value;start();options.release(50);}
    assert.equal(sent.length,2);
});

test('source artwork cannot contain authorization data and missing source values stay absent',()=>{
    const s=media.song({songfile:uri,tags:{common:{title:'Track'}}});
    assert.deepEqual(s.tags.format,{});assert.equal(s.albumart,'/IMG/Record.png');
    assert.equal(media.imageSource('https://i.scdn.co/image/x?token=secret'),'https://i.scdn.co/image/x');
});

function browserFixture(value) {
    const elements=new Map(),opened=[],listeners={};
    function element(){return {children:[],events:{},props:{},attrs:{},html(v){this.markup=v;return this;},text(v){this.label=v;return this;},prop(k,v){this.props[k]=v;return this;},attr(k,v){this.attrs[k]=v;return this;},empty(){this.children=[];return this;},append(...items){this.children.push(...items);return this;},on(k,fn){this.events[k]=fn;return this;}};}
    const $=query=>{if(typeof query==='function')return; if(query.startsWith('<')){const item=element();item.label=(query.match(/>([^<>]+)</)||[])[1];return item;}if(!elements.has(query))elements.set(query,element());return elements.get(query);};
    const context=vm.createContext({$,randyUI:{icon:()=>''},document:{addEventListener:(k,fn)=>listeners[k]=fn},window:{open:(...args)=>opened.push(args)},AbortSignal,AbortController,
        fetch:async()=>({ok:true,json:async()=>value}),setInterval(){},setTimeout,clearTimeout});
    vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../public/JS/spotify.js'),'utf8'),context);
    return {ui:context.spotifyUI,elements,opened,listeners};
}
test('Settings uses existing white device card for native Spotify controls, without an LMS settings link',()=>{
    const $=require('cheerio').load(fs.readFileSync(path.resolve(__dirname,'../public/index.html'),'utf8'));
    assert.equal($('#audio-output-settings .device').length,1);
    assert.equal($('#spotify-settings .device').length,1);
    assert.equal($('#spotify-settings-link').length,0);
    assert.equal($('#spotify-account-start,#spotify-account-remove,#spotify-playback-start,#spotify-client-id,#spotify-client-remove').length,5);
    assert.equal($('#spotify-settings .device #spotify-search-enabled').length,0);
    assert.equal($('#spotify-settings > label #spotify-search-enabled').length,1);
    assert.equal($('#replayselect').length,0);
});
test('late broken-cover response changes only its own image, never the new track cover',()=>{
    const b=browserFixture({});const current={src:'/spotify/artwork?url=new'};
    const old={tagName:'IMG',src:'/spotify/artwork?url=old',classList:{contains:()=>true},getAttribute(){return this.src;}};
    b.listeners.error({target:old});assert.equal(old.src,'/IMG/Record.png');assert.equal(current.src,'/spotify/artwork?url=new');
});

test('delayed album playback cannot overwrite a newer Spotify track selection',async()=>{
    const handlers={},calls=[];let resolveCollection;
    const spotify={status:async()=>({connected:true}),browse:()=>new Promise(r=>resolveCollection=r)};
    register({post:(p,h)=>handlers[p]=h,get(){}},{spotify,backend:'lms',playlist:{queueSpotify:(items,mode)=>{calls.push(mode);return items[0];}},playSong:async()=>{}});
    const response=()=>({status(){return this;},json(v){this.value=v;}});
    const old=response(),fresh=response();const pending=handlers['/spotify/queue']({body:{action:'play',key:'album'}},old);
    await new Promise(setImmediate);
    await handlers['/spotify/queue']({body:{action:'play',song:song()}},fresh);
    resolveCollection({items:[{song:song()}]});await pending;
    assert.equal(old.value.cancelled,true);assert.deepEqual(calls,['insert']);
});
test('delayed Spotify request respects a newer normal Randy playback selection',async()=>{
    const handlers={},calls=[];let finish,id=1;
    register({post:(p,h)=>handlers[p]=h,get(){}},{spotify:{status:()=>new Promise(r=>finish=r)},backend:'lms',
        getPlaybackId:()=>id,playlist:{queueSpotify:()=>calls.push('queue')},playSong:async()=>calls.push('play')});
    const res={status(){return this;},json(v){this.value=v;}};
    const pending=handlers['/spotify/queue']({body:{action:'play',song:song()}},res);id=2;finish({connected:true});await pending;
    assert.equal(res.value.cancelled,true);assert.equal(calls.length,0);
});


test('search timeout reports Spotify 429 from health counters even after rateLimited flag clears',async()=>{
    const f=fixture();f.health.api.api429Count=12;
    f.handler(async(u,o,c)=>{if(c?.[0]==='spoton'){f.health.api.api429Count=13;throw new DOMException('Timed out','TimeoutError');}});
    const result=await f.client.search('Air');assert.match(result.message,/rate limited/);
    assert.ok(f.client.blockedUntil-Date.now()>59000);
    const count=f.calls.length;const next=await f.client.search('Beatles');
    assert.equal(next.message,result.message);assert.equal(f.calls.length,count);
});
test('historical Spotify 429 errors alone do not mislabel an unrelated search failure',async()=>{
    const f=fixture();f.health.api.api429Count=30;
    f.handler(async(u,o,c)=>{if(c?.[0]==='spoton')throw new TypeError('fetch failed');});
    const result=await f.client.search('Air');assert.doesNotMatch(result.message,/rate limit/);assert.match(result.message,/LMS\/SpotOn search/);
});


test('personal Client ID search works independently of playback authorization',async()=>{
 const f=fixture();f.health.authHealth.id.playback.hasCredentials=0;
 const original=f.client.rpc.bind(f.client);f.client.rpc=(command,player)=>command[1]==='plugin.spoton:clientId'?Promise.resolve({_p2:'0123456789abcdef0123456789abcdef'}):original(command,player);
 const status=await f.client.status();assert.equal(status.connected,true);assert.equal(status.clientIdMode,'personal');assert.equal(status.playbackAuthorized,false);
 assert.equal((await f.client.search('Air')).tracks.length,1);
 const r=routes(f);assert.match((await r.invoke('/spotify/queue',{action:'play',song:song()})).value.error,/Authorize Spotify playback/);
});

test('cached account status still returns fresh playback ownership',async()=>{const f=fixture();await f.client.status();f.client.ownership.observe({mode:'play',time:1,playlist_loop:[{url:'spoton://connect-123'}]});assert.equal((await f.client.status()).ownership,'spotify_connect');});

test('Spotify artwork proxy requests 300px thumbnails and 640px now-playing without altering source URLs',async()=>{
 const f=fixture(),calls=[];
 f.client.request=async path=>{calls.push(path);return {headers:{get:()=> 'image/jpeg'},arrayBuffer:async()=>new Uint8Array([1,2]).buffer};};
 await f.client.image(art,300);await f.client.image(art,640);
 assert.equal(calls[0],'/imageproxy/'+encodeURIComponent(art)+'/image_300x300_o');
 assert.equal(calls[1],'/imageproxy/'+encodeURIComponent(art)+'/image_640x640_o');
 await assert.rejects(f.client.image(art,4096),/Invalid artwork size/);
});
test('general search presents tracks albums and artists while retaining playlist backend support',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../public/JS/spotify.js'),'utf8');
 assert.match(source,/\['tracks', 'albums', 'artists'\]\.forEach/);
 assert.doesNotMatch(source,/\['tracks', 'albums', 'artists', 'playlists'\]\.forEach/);
 const f=fixture();return f.client.search('Air').then(result=>assert.equal(result.playlists.length,1));
});
