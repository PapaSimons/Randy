'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {provider,local,track,nav}=require('./helpers/library-fixture');

test('local library exposes cached Artists/Albums/Tracks and preserves original album paths/actions',()=>{
    const f=local(),data=f.api.getLibrary();
    assert.deepEqual(Array.from(data.artists,a=>a.title),['John Coltrane','Miles Davis']);
    assert.equal(data.albums.length,2);assert.equal(data.tracks.length,2);
    const artist=data.artists.find(a=>a.title==='Miles Davis');assert.equal(artist.albums[0],'/music/Miles Davis/Kind of Blue');
    const album=f.api.getAlbum(artist.albums[0]);assert.equal(album.name,'Kind of Blue');assert.equal(album.files[0].path,f.tracks[0]);
    f.tracks.length=0;assert.equal(f.api.getLibrary().artists.length,0);
});
test('Spotify library home only exposes Liked Songs and library Playlists',async()=>{
    const f=provider(),home=await f.client.library();
    assert.equal(home.available,true);assert.deepEqual(home.items.map(i=>i.title),['Liked Songs','Playlists']);
    assert.deepEqual(f.calls.map(c=>c.id),['root','library']);assert.ok(home.items.every(i=>f.client.handles.get(i.key).library));
});
test('Spotify hidden when unavailable; installed unauthenticated account has a connect state',async()=>{
    const f=provider();f.status({state:'not-installed',connected:false});assert.equal((await f.client.library()).available,false);
    f.status({version:'3.5.8',state:'auth-expired',connected:false});const state=await f.client.library();
    assert.equal(state.available,true);assert.equal(state.connected,false);assert.match(state.message,/Connect Spotify/);assert.equal(f.calls.length,0);
});
test('missing library feed hides the source without falling back to public search',async()=>{
    const f=provider();f.feeds.root={item_loop:[{icon:'html/images/search.png',actions:{go:nav('search')}}]};
    assert.equal((await f.client.library()).available,false);assert.equal(f.calls.some(c=>c.id==='search'),false);
});
test('Liked Songs loads one bounded page and reuses normalized track queue data',async()=>{
    const f=provider(),home=await f.client.library();f.feeds.liked=(offset,count)=>({count:101,item_loop:Array.from({length:Math.min(count,101-offset)},(_,i)=>track('Track '+(offset+i)))});
    const a=await f.client.library({section:'browse',key:home.items[0].key});
    assert.equal(a.items.length,50);assert.equal(a.hasMore,true);assert.equal(a.nextOffset,50);assert.equal(a.total,101);assert.equal(a.items[0].song.type,'spotify');
    const b=await f.client.library({section:'browse',key:home.items[0].key,offset:a.nextOffset});assert.equal(b.nextOffset,100);
    assert.ok(f.calls.filter(c=>c.id==='liked').every(c=>c.count===50));
});
test('owned playlist opens from its library handle; public search handles cannot enter the library',async()=>{
    const f=provider(),home=await f.client.library();const playlists=await f.client.library({section:'browse',key:home.items[1].key});
    assert.equal(playlists.items[0].title,'Aba');const page=await f.client.library({section:'browse',key:playlists.items[0].key});assert.equal(page.items[0].title,'Playlist track');
    assert.equal(page.items[0].song.parentUri,playlists.items[0].uri);
    const publicItem=f.client.remember({kind:'playlist',title:'Public result'},{item_id:'public-search'});
    await assert.rejects(f.client.library({section:'browse',key:publicItem.key}),/expired/);assert.equal(f.calls.some(c=>/search|public/.test(c.id)),false);
});
test('library playlist queue expansion resolves through Library rather than Spotify search',async()=>{
    const f=provider(),home=await f.client.library(),list=await f.client.library({section:'browse',key:home.items[1].key});
    const page=await f.client.browse(list.items[0].key,true);assert.equal(page.enumerable,true);assert.equal(page.items.length,1);
    assert.equal(f.calls.some(c=>/search/.test(c.id)),false);
});
test('empty liked songs, empty playlist and expired/malformed pagination are safe',async()=>{
    const f=provider(),home=await f.client.library();f.feeds.liked={count:0,item_loop:[]};
    const page=await f.client.library({section:'browse',key:home.items[0].key});assert.equal(page.items.length,0);assert.equal(page.hasMore,false);
    for(const offset of [-1,0.5,'bad'])await assert.rejects(f.client.library({section:'browse',key:home.items[0].key,offset}),/Invalid/);
    f.client.handles.clear();await assert.rejects(f.client.library({section:'browse',key:home.items[0].key}),/expired/);
});
test('library endpoint hides provider errors and does not expose Spotify for MPV',async()=>{
    const register=require('../lib/spotify-routes'),f=provider(),handlers={};
    register({post:(p,h)=>handlers[p]=h,get(){}},{spotify:f.client,playlist:{},backend:'lms'});
    f.feeds.root=Error('SECRET raw LMS stack');let value,status;const res={json:v=>{value=v;},status:n=>{status=n;return res;}};
    await handlers['/spotify/library']({body:{}},res);assert.equal(status,400);assert.doesNotMatch(value.error,/SECRET|LMS|stack/);
    register({post:(p,h)=>handlers[p]=h,get(){}},{spotify:f.client,playlist:{},backend:'mpv'});
    await handlers['/spotify/library']({body:{}},res);assert.equal(value.available,false);
});

test('provider text failures are not mistaken for reliable counts or leaked to the UI',async()=>{
    const f=provider(),home=await f.client.library();f.feeds.liked={count:1,item_loop:[{type:'text',text:'SECRET missing permission in LMS'}]};
    const page=await f.client.library({section:'browse',key:home.items[0].key});assert.equal(page.total,null);assert.equal(page.hasMore,false);
    assert.match(page.message,/unavailable/);assert.doesNotMatch(JSON.stringify(page),/SECRET|permission|LMS/);
});

test('library access does not depend on enabling Spotify search',async()=>{
    const f=provider();f.status({version:'3.5.8',connected:true,state:'connected',includeSearch:false});
    assert.equal((await f.client.library()).available,true);
});
