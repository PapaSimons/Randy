'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createLog,category}=require('../lib/spotify-log');
const {Ownership}=require('../lib/spotify-ownership');
test('Spotify console logging allows diagnostic fields but excludes credentials and raw payloads',()=>{
    const lines=[],log=createLog({log:line=>lines.push(line),warn:line=>lines.push(line)});
    log('request-error',{operation:'search',category:'authorization',code:403,
        token:'secret',password:'secret',account:'Listener',url:'https://x?token=secret',error:new Error('secret'),state:'Bearer secret'});
    assert.match(lines[0],/\[Spotify\] request-error/);assert.match(lines[0],/403/);
    assert.doesNotMatch(lines[0],/secret|Listener|https|password|token/);
});
test('errors are categorized without writing raw error messages',()=>{
    assert.equal(category(new Error('fetch failed')),'connection');
    assert.equal(category({code:429,message:'secret'}),'rate-limited');
    assert.equal(category(new Error('Spotify needs to reconnect')),'authorization');
    assert.equal(category({name:'TimeoutError'}),'timeout');
});
test('Connect polls log playback changes once rather than every position update',()=>{
    const events=[],owner=new Ownership({log:(event,fields)=>events.push({event,fields})});
    const raw={mode:'play',time:1,playlist_loop:[{url:'spoton://connect-test',title:'Private title'}]};
    owner.observe(raw);owner.observe({...raw,time:2});owner.observe({...raw,mode:'pause'});
    assert.equal(events.filter(e=>e.event==='ownership').length,1);
    assert.equal(events.filter(e=>e.event==='connect-playback').length,2);
    assert.doesNotMatch(JSON.stringify(events),/Private title|connect-test/);
});
