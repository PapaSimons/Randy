'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const createSpotify=require('../../lib/spotify');
const trackId='3M0zi8iD2KRzY71XcGFUpE',playlistId='2CKnioFobYQRK3EEMf9Jr6';
const nav=item_id=>({cmd:['spoton','items'],params:{item_id}});
function track(title='Liked track'){return {text:title+'\nArtist • Album',presetParams:{favorites_url:'spoton://track:'+trackId},duration:180};}
function provider(){
    const calls=[],client=createSpotify({log(){}});
    let status={version:'3.5.8',connected:true,state:'connected',includeSearch:true,playbackAuthorized:true};
    const feeds={
        root:{item_loop:[{icon:'html/images/musicfolder.png',actions:{go:nav('library')}},{icon:'html/images/search.png',actions:{go:nav('search')}}]},
        library:{item_loop:[{text:'Liked Songs',icon:'html/images/song.png',actions:{go:nav('liked')}},{text:'Playlists',icon:'html/images/playlists.png',actions:{go:nav('owned')}},{text:'Albums',icon:'html/images/albums.png',actions:{go:nav('saved-albums')}},{text:'Daily Mixes',actions:{go:nav('mixes')}}]},
        liked:{count:1,item_loop:[track()]},
        owned:{count:1,item_loop:[{text:'Aba\nListener',presetParams:{favorites_url:'spoton://playlist:'+playlistId},params:{item_id:'owned.0'}}]},
        'owned.0':{count:1,item_loop:[track('Playlist track')]}
    };
    client.status=async()=>status;
    client.items=async(params={},offset=0,count=50)=>{calls.push({id:params.item_id||'root',offset,count});const feed=feeds[params.item_id||'root'];if(feed instanceof Error)throw feed;return typeof feed==='function'?feed(offset,count):feed || {count:0,item_loop:[]};};
    return {client,calls,feeds,status:value=>{status=value;}};
}
function local(){
    const tracks=['/music/Miles Davis/Kind of Blue/So What.flac','/music/John Coltrane/Blue Train/Blue Train.flac'];
    const cache=new Map(tracks.map((file,index)=>[file,{albumart:'/IMG/Record.png',tags:{common:{title:index?'Blue Train':'So What',artist:index?'John Coltrane':'Miles Davis',album:index?'Blue Train':'Kind of Blue'}}}]));
    const source=fs.readFileSync(path.resolve(__dirname,'../../lib/playlist_utils.js'),'utf8');
    const api=vm.runInNewContext('({'+source.slice(source.indexOf('    getAlbum: function'),source.indexOf('    getAlbums: function'))+'})',
        {path,allsongs:tracks,cdb:{has:p=>cache.has(p),get:p=>cache.get(p)},checkFolderAlbumArt:()=>null,console:{log(){}}});
    return {api,tracks,cache};
}
module.exports={provider,local,track,nav};
