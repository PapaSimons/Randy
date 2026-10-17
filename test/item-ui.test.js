'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),cheerio=require('cheerio');
function fixture(){const base=cheerio.load(''),events=new WeakMap();const $=value=>{if(typeof value==='function')return;const el=base(value);el.on=function(name,callback){events.set(this[0],callback);return this;};return el;};const context=vm.createContext({$,URL,document:{addEventListener(){}},window:{location:{origin:'http://randy'}}});vm.runInContext(fs.readFileSync(require.resolve('../public/JS/item-ui.js'),'utf8'),context);return {ui:context.randyUI,events,context,base};}
test('local and Spotify tracks share markup, artwork, typography and accessible action positions',()=>{
 const {ui,events}=fixture(),calls=[];const actions={play:()=>calls.push('play'),add:()=>calls.push('add'),sticky:()=>calls.push('sticky')};
 const local=ui.row({title:'Song',artist:'Artist',source:'local'},actions),spotify=ui.row({title:'Song',artist:'Artist',source:'spotify'},actions);
 assert.equal(local.attr('class'),spotify.attr('class'));
 for(const row of[local,spotify]){assert.equal(row.find('img').attr('src'),'/IMG/Record.png');assert.deepEqual(row.find('button').map((i,e)=>e.attribs['aria-label']).get(),['Play','Add to queue','Sticky']);}
 for(const button of spotify.find('button').toArray())events.get(button)();assert.deepEqual(calls,['play','add','sticky']);
});
test('all touched actions use consistent SVGs without external icon dependencies',()=>{
 const {ui}=fixture();for(const name of['play','add','sticky','spotify','local','external','settings','home','folder','close','search','back','next','menu','check','spinner']){const icon=ui.icon(name,name);assert.match(icon,/viewBox="0 0 24 24"/);assert.match(icon,/aria-label=/);assert.doesNotMatch(icon,/<img|https?:|font/);}
});
test('Spotify artwork uses explicit thumbnail and now-playing proxy sizes',()=>{
 const {ui}=fixture();assert.match(ui.coverUrl('/spotify/artwork?url=public',300),/size=300/);assert.match(ui.coverUrl('/spotify/artwork?url=public',640),/size=640/);assert.equal(ui.coverUrl(null),'/IMG/Record.png');
});
test('titles are text, never injected markup, for both item sources',()=>{
 const {ui}=fixture();for(const source of['local','spotify']){const row=ui.row({source,title:'<script>alert(1)</script>'},{});assert.equal(row.find('script').length,0);assert.match(row.find('.randy-item-title').text(),/<script>/);}
});

test('Connect playlist row shows details and duration without album artwork',()=>{
 const f=fixture();f.base('body').append('<div id="spotify-connect-toast"></div><div id="songlist"></div>');
 vm.runInContext(fs.readFileSync(require.resolve('../public/JS/spotify.js'),'utf8'),f.context);
 f.context.spotifyUI.setOwnership({state:'spotify_connect',playbackState:'playing',trackKey:'A'});
 f.context.spotifyUI.setOwnership({state:'spotify_connect',playbackState:'playing',trackKey:'A'});
 const row=f.base('#spotify-connect-nowplaying');assert.equal(row.length,1);assert.equal(row.children('.onesong-details').length,1);
 assert.equal(row.children('.randy-cover').length,0);assert.equal(row.children('.onesong-len').length,1);assert.equal(row.find('small').length,0);
});

test('source icons are shown only for Spotify',()=>{
 const {ui}=fixture();assert.equal(ui.sourceIcon('local'),'');assert.equal(ui.sourceIcon('file'),'');
 assert.match(ui.sourceIcon('spotify'),/aria-label="Spotify"/);
 const local=ui.row({source:'local',title:'Local'},{});assert.equal(local.find('.randy-source').length,0);
});

test('Spotify album search row offers Play/Add while its title still opens the album',()=>{
 const f=fixture(),calls=[];
 const source=fs.readFileSync(require.resolve('../public/JS/spotify.js'),'utf8');
 f.context.action=(item,name)=>calls.push(name);f.context.open=item=>calls.push('open');
 vm.runInContext(source.slice(source.indexOf('    function row(item)'),source.indexOf('    function open(item)')),f.context);
 const row=f.context.row({kind:'album',title:'Album',key:'album-key'});
 assert.deepEqual(row.find('button').map((i,e)=>e.attribs['aria-label']).get(),['Play','Add to queue']);
 for(const button of row.find('button').toArray())f.events.get(button)();
 f.events.get(row.find('.search-result-name')[0])();assert.deepEqual(calls,['play','add','open']);
});

test('local album endpoint supplies cached cover artwork and track metadata to the detail view',()=>{
 const source=fs.readFileSync(require.resolve('../lib/playlist_utils.js'),'utf8');
 const start=source.indexOf('    getAlbum: function(d){'),end=source.indexOf('    getAlbums:',start);
 const context=vm.createContext({path:require('node:path'),allsongs:['/music/Album/track.flac'],
  cdb:{has:()=>true,get:()=>({albumart:'/mnt/Album/cover.jpg',tags:{common:{title:'Song',artist:'Artist',album:'Album'}}})},
  checkFolderAlbumArt:()=>null,console:{log(){}}});
 const api=vm.runInContext('({'+source.slice(start,end)+'})',context),album=api.getAlbum('/music/Album');
 assert.equal(album.albumart,'/mnt/Album/cover.jpg');assert.equal(album.files[0].albumart,album.albumart);
 assert.equal(album.files[0].title,'Song');assert.equal(album.artist,'Artist');
});

test('navigation and loading controls use shared inline icons instead of image files',()=>{
 const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
 const main=fs.readFileSync(require.resolve('../public/JS/main.js'),'utf8');
 assert.doesNotMatch(html+main,/IMG\/(?:House_01|Folder|Settings|Close_MD|Search_Magnifying_Glass|Spin|Check_16|Arrow_Right_MD)\.svg/);
 const $=cheerio.load(html);
 assert.equal($('button[data-randy-icon="home"][aria-label="Home"]').length,1);
 assert.equal($('button[data-randy-icon="search"][aria-label="Search"]').length,1);
 assert.equal($('.prev[data-randy-icon="back"][tabindex="0"]').length,1);
 assert.equal($('.next[data-randy-icon="next"][tabindex="0"]').length,1);
});
