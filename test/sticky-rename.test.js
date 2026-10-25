'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fixture=require('./helpers/sticky-fixture');

test('rename changes only name, preserves identity/order/contents/queue, and survives restart',async()=>{
    const f=await fixture(),before=JSON.parse(JSON.stringify(f.playlist.getStickyList()));
    const queue=JSON.stringify(f.playlist.getPlayList()),position=f.playlist.getPlaying();
    const saved=f.playlist.renameSticky(before[0].id,'  Sunday Jazz  ');
    assert.equal(saved.name,'Sunday Jazz');assert.equal(saved.id,before[0].id);
    const after=JSON.parse(JSON.stringify(f.playlist.getStickyList()));
    assert.deepEqual(after.map(s=>s.id),before.map(s=>s.id));
    assert.deepEqual(after.map(s=>s.path),before.map(s=>s.path));
    assert.deepEqual(after.slice(1),before.slice(1));
    assert.equal(JSON.stringify(f.playlist.getPlayList()),queue);assert.equal(f.playlist.getPlaying(),position);
    await new Promise(r=>setImmediate(r));assert.equal(f.events.queue,0);assert.equal(f.events.sticky,1);
    const restarted=await fixture(f.root);
    assert.equal(restarted.playlist.getStickyList()[0].name,'Sunday Jazz');
    assert.equal(restarted.playlist.getStickyList()[0].id,before[0].id);
    const stored=JSON.parse(fs.readFileSync(path.join(f.root,'ldb.json'))).stickylist;
    assert.equal(stored[0].name,'Sunday Jazz');assert.equal('id' in stored[0],false);
});
test('old stickies retain stored default names and duplicate titles identify separate contents',async()=>{
    const f=await fixture(),old=f.playlist.getStickyList();assert.equal(old[0].name,'Kind of Blue');
    f.playlist.renameSticky(old[0].id,'Same');f.playlist.renameSticky(old[1].id,'Same');
    assert.deepEqual(Array.from(f.playlist.getStickyList(),s=>s.name),['Same','Same','Track']);
    f.playlist.renameSticky(old[1].id,'Other');assert.equal(f.playlist.getStickyList()[0].name,'Same');
});
test('empty, malformed and overlong titles reject without changing storage',async()=>{
    const f=await fixture(),id=f.playlist.getStickyList()[0].id,before=fs.readFileSync(path.join(f.root,'ldb.json'),'utf8');
    for(const title of ['', '   ', 'x'.repeat(101),null,{},12])assert.throws(()=>f.playlist.renameSticky(id,title),e=>e.status===400);
    assert.equal(fs.readFileSync(path.join(f.root,'ldb.json'),'utf8'),before);
    assert.equal(f.playlist.renameSticky(id,'x'.repeat(100)).name.length,100);
});
test('unknown identifiers and malformed request are handled cleanly',async()=>{
    const f=await fixture();assert.throws(()=>f.playlist.renameSticky('a'.repeat(64),'Title'),e=>e.status===404);
    for(const id of [null,42,'not-an-id'])assert.throws(()=>f.playlist.renameSticky(id,'Title'),e=>e.status===400);
});
test('failed persistence retains the previous title and returns a safe error',async()=>{
    const f=await fixture(),before=JSON.stringify(f.playlist.getStickyList()),stored=fs.readFileSync(path.join(f.root,'ldb.json'),'utf8');
    f.dbs.ldb.set=function(key,value){this.storage[key]=value;throw Error('SECRET filesystem path');};
    assert.throws(()=>f.playlist.renameSticky(f.playlist.getStickyList()[0].id,'Changed'),e=>e.status===500&&!e.message.includes('SECRET'));
    assert.equal(JSON.stringify(f.playlist.getStickyList()),before);assert.equal(fs.readFileSync(path.join(f.root,'ldb.json'),'utf8'),stored);
    assert.equal(f.events.sticky,0);
});
test('rename endpoint uses the existing playlist service and hides internal failures',async()=>{
    const source=fs.readFileSync(path.resolve(__dirname,'../index.js'),'utf8');let handler;
    const f=await fixture();
    const context=vm.createContext({app:{post:(route,fn)=>{assert.equal(route,'/renameSticky');handler=fn;}},playlist:f.playlist});
    vm.runInContext(source.slice(source.indexOf("app.post('/renameSticky'"),source.indexOf("app.post('/getAlbums'")),context);
    const invoke=body=>{let status=200,result;const res={status:n=>{status=n;return res;},json:r=>{result=r;}};handler({body},res);return {status,result};};
    assert.equal(invoke({id:f.playlist.getStickyList()[0].id,title:'Sunday'}).result.sticky.name,'Sunday');
    assert.equal(invoke({}).status,400);assert.equal(invoke({id:'a'.repeat(64),title:'Other'}).status,404);
    f.playlist.renameSticky=()=>{throw Error('SECRET stack');};
    const failed=invoke({});assert.equal(failed.status,500);assert.doesNotMatch(JSON.stringify(failed),/SECRET|stack/);
});
test('renamed Spotify sticky retains existing delete identity and the other stickies',async()=>{
    const f=await fixture(),sticky=f.playlist.getStickyList()[2];
    f.playlist.renameSticky(sticky.id,'Spotify favorite');await f.playlist.removesticky(sticky.path);
    assert.equal(f.playlist.getStickyList().length,2);assert.equal(f.playlist.getStickyList()[0].name,'Kind of Blue');
});
