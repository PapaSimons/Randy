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

test('Connect uses only the overlay and detached seek state without inserting or changing a queue item',()=>{
 const f=fixture();f.base('body').append('<div id="spotify-connect-toast"></div><div id="songlist"><div id="song_0" class="onesong onesong-current">Local title</div></div>');
 f.context.cursong=f.base('#song_0');
 vm.runInContext(fs.readFileSync(require.resolve('../public/JS/spotify.js'),'utf8'),f.context);
 f.context.spotifyUI.setOwnership({state:'spotify_connect',playbackState:'playing',trackKey:'A'});
 assert.equal(f.base('#spotify-connect-nowplaying').length,0);
 assert.equal(f.base('#songlist .onesong').length,1);assert.equal(f.base('#song_0').text(),'Local title');
 assert.equal(f.context.cursong.find('.onesong-len').length,1);
 f.context.cursong.find('.onesong-len').attr('len','123');assert.equal(f.context.cursong.find('.onesong-len').attr('len'),'123');
 f.context.spotifyUI.setOwnership({state:'randy'});assert.equal(f.context.cursong.attr('id'),'song_0');
 assert.equal(f.base('#song_0').hasClass('onesong-current'),true);
});

test('source icons are shown only for Spotify',()=>{
 const {ui}=fixture();assert.equal(ui.sourceIcon('local'),'');assert.equal(ui.sourceIcon('file'),'');
 assert.match(ui.sourceIcon('spotify'),/aria-label="Spotify"/);
 const local=ui.row({source:'local',title:'Local'},{});assert.equal(local.find('.randy-source').length,0);
});

test('Spotify album search row offers Play/Add/Bookmark while its title still opens the album',()=>{
 const f=fixture(),calls=[];
 const source=fs.readFileSync(require.resolve('../public/JS/spotify.js'),'utf8');
 f.context.action=(item,name)=>calls.push(name);f.context.open=item=>calls.push('open');
 vm.runInContext(source.slice(source.indexOf('    function row('),source.indexOf('    function backFromSpotify(')),f.context);
 const row=f.context.row({kind:'album',title:'Album',key:'album-key'});
 assert.deepEqual(row.find('button').map((i,e)=>e.attribs['aria-label']).get(),['Play','Add to queue','Sticky']);
 for(const button of row.find('button').toArray())f.events.get(button)();
 f.events.get(row.find('.search-result-name')[0])();assert.deepEqual(calls,['play','add','sticky','open']);
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

test('Connect chime sounds once per session, never on song changes or pause/resume',()=>{
 const f=fixture(),listeners={},notes=[];
 f.context.document.addEventListener=(name,callback)=>listeners[name]=callback;
 f.context.window.AudioContext=class {
  constructor(){this.state='running';this.currentTime=0;this.destination={};}
  createOscillator(){return {frequency:{},connect(){},start(){notes.push(this.frequency.value);},stop(){},disconnect(){}};}
  createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
 };
 f.base('body').append('<div id="spotify-connect-toast"></div><div id="songlist"></div>');
 vm.runInContext(fs.readFileSync(require.resolve('../public/JS/spotify.js'),'utf8'),f.context);
 listeners.pointerdown();const ui=f.context.spotifyUI;
 ui.setOwnership({state:'spotify_connect'});assert.equal(notes.length,0);
 ui.setOwnership({state:'spotify_connect',playbackState:'playing',trackKey:'A'});assert.equal(notes.length,2);
 ui.setOwnership({state:'spotify_connect',playbackState:'playing',trackKey:'B'});
 ui.setOwnership({state:'spotify_connect',playbackState:'paused'});
 ui.setOwnership({state:'spotify_connect',playbackState:'playing'});assert.equal(notes.length,2);
 ui.setOwnership({state:'randy'});ui.setOwnership({state:'spotify_connect',playbackState:'playing'});assert.equal(notes.length,4);
});
test('Connect works when browser audio is unavailable or has not been unlocked',()=>{
 const f=fixture();f.base('body').append('<div id="spotify-connect-toast"></div><div id="songlist"></div>');
 vm.runInContext(fs.readFileSync(require.resolve('../public/JS/spotify.js'),'utf8'),f.context);
 assert.doesNotThrow(()=>f.context.spotifyUI.setOwnership({state:'spotify_connect',playbackState:'playing'}));
 assert.equal(f.base('#spotify-connect-toast').prop('hidden'),false);
});

test('Spotify search source icon is inside the title and outside actions',()=>{
 const {ui}=fixture();const row=ui.row({source:'spotify',title:'Album'}, {play(){}});
 assert.equal(row.find('.randy-item-title .randy-source').length,1);
 assert.equal(row.children('.randy-source').length,0);
 assert.equal(row.find('.randy-item-actions .randy-source').length,0);
 assert.equal(row.find('.randy-item-title').text(),'Album');
});

test('saved album bookmark actions use Spotify while removal retains the existing bookmark path',()=>{
 const source=fs.readFileSync(require.resolve('../public/JS/main.js'),'utf8');const calls=[];
 const album={type:'spotify-album',songfile:'spoton://album:3M0zi8iD2KRzY71XcGFUpE'};
 const context=vm.createContext({templist:{bookmarks:[album]},console:{log(){}},
  spotifyUI:{albumAction:(item,action)=>calls.push(['spotify',action,item])},socket:{emit:(op,item)=>calls.push(['socket',op,item])},
  $:()=>({toggleClass(){}}),showToast(){},browsepane(){},curbrowserpanemode:'stickies'});
 vm.runInContext(source.slice(source.indexOf('function doSongOption('),source.indexOf('////utils////')),context);
 context.doSongOption('playnow','bookmarks',0);context.doSongOption('addtolist','bookmarks',0);context.doSongOption('unstick','bookmarks',0);
 assert.deepEqual(calls.map(c=>c.slice(0,2)),[['spotify','play'],['spotify','add'],['socket','unstick']]);
 assert.ok(calls.every(c=>c[2]===album));
});
