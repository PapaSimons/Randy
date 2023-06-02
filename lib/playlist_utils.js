// =========================================================
// Random player playlist utils
// built by : Gideon Simons, 2018
// =========================================================

//dependancies
var fs = require('fs');
var path = require('path');
var url = require('url');
var JSONdb = require('simple-json-db');
var FileHound = require('filehound');
var mm = require('music-metadata');
var albumArt = require('album-art');
var metaget = require("metaget");
var observe = require('smart-observe');
var needle = require('needle');
const { json } = require('express');

//-- Databases --//
//all songs
var adb = new JSONdb(path.join(__dirname, '..', '/DB/adb.json'));
//metadata cache
var cdb = new JSONdb(path.join(__dirname, '..', '/DB/cdb.json'));
//status
var sdb = new JSONdb(path.join(__dirname, '..', '/DB/sdb.json'));
//playlist
var pdb = new JSONdb(path.join(__dirname, '..', '/DB/pdb.json'));
//sticky
var ldb = new JSONdb(path.join(__dirname, '..', '/DB/ldb.json'));
//options
var odb = new JSONdb(path.join(__dirname, '..', '/DB/odb.json'));

var allsongs = [];
var plobj = {
    stickylist: [],
    randylist: [],
    status: {
        playing:0,
        seek:0,
        playlist:null
    }
};

var settings = {
    musicfolders:null
}
var Numofnextsongs = 3;
var Maxrandhistory = 50;
var Emitproblem = null;

//const filetypes = /\.(?:wav|mp3|flac|mpa|aac|oga|pls|ape|aif|aiff|aifc|asf|wma|m4a|m4b|m4p|m4v|m4r|mp4|mp2|m2a|ogv|oga|ogx|ogg|opus|wv|wvp)$/i;//removed m3u
var filetypesarr = [".wav", ".mp3", ".flac", ".mpa", ".aac", ".oga", 
                    ".pls", ".ape", ".aif", ".aiff", ".aifc", ".asf", 
                    ".wma", ".m4a", ".m4b", ".m4p", ".m4v", ".m4r", 
                    ".mp4", ".mp2", ".m2a", ".ogv", ".oga", ".ogx", 
                    ".ogg", ".opus", ".wv", ".wvp"];

//var musicfolder = "/Users/gideonsimons/Documents/whatgot/";
//var musicfolder = "/media/usb";
//var musicfolder = "/media/nas";

//expose the main function
module.exports = {
    
    randy: async function(){
        pdb.delete('playlist');
        sdb.delete('status');
        plobj.randylist = await initRlist();
        return setplaying(0);
    },
    
    setMusicFolder: async function(mf) {
        for (i = 0; i<mf.length; i++){
            if (!fs.existsSync(mf[i])){
                return Promise.reject("Folder does not exist! " + mf[i]);
            }
        }
        adb.delete('allsongs');
        sdb.delete('status');
        pdb.delete('playlist');
        settings.musicfolders = mf;
        odb.set('settings',settings);
        await this.getAllSongs();
        //cacheAllSongs();
        plobj.randylist = await initRlist();
        return setplaying(0);
    },
    
    getSettings: function(){
        if (odb.has('settings')){
            settings = odb.get('settings');
        } else {
            odb.set('settings',settings);
        } 
        return settings;
    },

    setSetting: function(obj, key){
        if (odb.has('settings')){
            settings = odb.get('settings');
        }
        settings[obj] = key;
        odb.set('settings',settings);
        return settings;
    },
    
    getAllSongs: function(){
        
        return new Promise(function(resolve, reject) {
            console.log("getAllSongs");
            //check if already saved
            if (adb.has('allsongs')){
                var alls = adb.get('allsongs');
                if (alls.hasOwnProperty('songs')){
                    allsongs = alls.songs;
                    resolve();
                } else {
                    reject('Problem loading all files');
                }
            } else {
                var filehound = FileHound.create();
                var musicfolders = settings.musicfolders;
                filehound
                  .paths(musicfolders)
                  .ext(filetypesarr)
                  .ignoreHiddenDirectories()
                  .ignoreHiddenFiles()
                  .find();

                filehound.find((err, files) => {
                    if (err){
                        console.error("filehound error: " + err);
                        reject(err);
                    }
                    allsongs = files;
                    adb.set('allsongs', {folder:musicfolders, songs:allsongs});
                    resolve();
                });
            }
        });
    },
    
    getStickyList: function (limit){
        var temparr = [];
        var len = limit;
        if (plobj.stickylist.length < limit || !limit){
            len = plobj.stickylist.length;
        }
        for (i=0; i<len; i++){
            temparr.push(plobj.stickylist[i]);
        }
        return temparr;
    },
    
    searchSongs: async function(keyword){
        var rtn = {albums:[],files:[],radiostations:[]};
        rtn.radiostations = await getRadios(keyword);
        for (s in allsongs){
            var i = allsongs[s];
            var pp = path.parse(i);
            //check keyword in directories + remove dups
            if (pp.dir.toLowerCase().indexOf(keyword.toLowerCase()) !== -1){
                //get album name
                var dirs = pp.dir.toLowerCase().split(path.sep);
                //look for the album
                var founda = -1;
                for (a in rtn.albums){
                    if (rtn.albums[a].album == pp.dir){
                        founda = a;
                    }
                }
                if (founda > -1){
                    rtn.albums[founda].path.push(i);
                } else {
                    rtn.albums.push({name:dirs[(dirs.length - 1)],album:pp.dir,albumpath:path.dirname(pp.dir),path:[i]});
                }
            }
            //check keyword in files 
            if (pp.name.toLowerCase().indexOf(keyword.toLowerCase()) !== -1){
                rtn.files.push({name:pp.name,path:i});
            }
        }
        console.log("search with keyword " + keyword +
                     " - found files: " + rtn.files.length + 
                     " , albums: " + rtn.albums.length + 
                     " , radiostations: " + rtn.radiostations.length);
        console.log(rtn);
        return rtn;
    },
    
    getAlbum: function(d){
        var rtn = {name:path.parse(d).name,files:[]};
        for (s in allsongs){
            var i = allsongs[s];
            var pp = path.parse(i);
            //check directory matchs album 
            if (pp.dir == d){
                rtn.files.push({name:pp.name,path:i});
            }
        }
        console.log("found files: " + rtn.files.length);
        return rtn;
    },
    
    getAlbums: function(l){
        var rtn = {albums:[]};
        var limit = 1;
        var len = l;
        if (allsongs.length < l || !l){
            len = allsongs.length;
        }
        for (s in allsongs){
            var i = allsongs[s];
            var pp = path.parse(i);
            //get album name
            var dirs = pp.dir.toLowerCase().split(path.sep);
            //look for the album
            var founda = -1;
            for (a in rtn.albums){
                if (rtn.albums[a].album == pp.dir){
                    founda = a;
                }
            }
            if (founda > -1){
                if (limit == len){
                    console.log(rtn);
                    return rtn;
                } else {
                    limit++;
                }
                rtn.albums[founda].path.push(i);
            } else {
                rtn.albums.push({name:dirs[(dirs.length - 1)],album:pp.dir,albumpath:path.dirname(pp.dir),path:[i]});
            }
        }
        console.log("found " + rtn.albums.length + " albums");
        return rtn;
    },
    
    getRandomAlbums: async function(l){
        var rtn = {albums:[]};
        var temparr = [];
        var limit = 0;
        for (s in allsongs){
            var i = allsongs[s];
            var pp = path.parse(i);
            //get album name
            var dirs = pp.dir.toLowerCase().split(path.sep);
            //look for the album
            var founda = -1;
            for (a in temparr){
                if (temparr[a].album == pp.dir){
                    founda = a;
                }
            }
            if (founda > -1){
                temparr[founda].path.push(i);
            } else {
                temparr.push({name:dirs[(dirs.length - 1)],album:pp.dir,albumpath:path.dirname(pp.dir),path:[i]});
            }
        }
        var len = l;
        if (temparr.length < l){
            len = temparr.length;
        }
        while (limit < len){
            var ranAlb = temparr.splice(getRandomInt(0, (temparr.length - 1)), 1)[0];
            var met = await getMeta(ranAlb.path[0]);
            if (met !== null){
                ranAlb.albumArt = met.albumart;
                rtn.albums.push(ranAlb);
            }
            limit++;
        }
        return rtn;
    },
    
    getPlobj: function(){
        return plobj;
    },
    
    getPlayList: function(){
        return plobj.randylist;
    },
    
    getNextsPlayList: function(){
        return plobj.randylist.slice((plobj.status.playing+1));
    },
    
    getCurrentSong: function(){
        return plobj.randylist[plobj.status.playing];
    },
    
    getPlaying: function(){
        return plobj.status.playing;
    },
    
    //check if it's a web stream url
    checkAudioStream: async function (link){
        return await isAudioStream(link);
    },

    //get best metadata for web url
    getBestMeta: function (meta, link){
        return getBestMetaData(meta, link);
    },

    //create a new random playlist
    initPlaylist: async function (emitplaylist, emitsticky, emitproblem){
        Emitproblem = emitproblem;
        console.log("initPlaylist and setting watchers");
        //check if already saved
        if (pdb.has('playlist')){
            plobj.randylist = pdb.get('playlist');
        } else {
            plobj.randylist = await initRlist();
            pdb.set('playlist', plobj.randylist);
        }
        if (sdb.has('status')){
            plobj.status = sdb.get('status');
        } else {
            sdb.set('status',plobj.status);
        }
        if (ldb.has('stickylist')){
            plobj.stickylist = ldb.get('stickylist');
        } else {
            ldb.set('stickylist',plobj.stickylist);
        }
        //watchers
        observe(plobj,'randylist', function(newValue, oldValue){
            //console.log("randylist changed");
            emitplaylist();
            pdb.set('playlist', newValue);
        });
        observe(plobj, 'stickylist', function(newValue, oldValue){
            console.log("stickylist changed");
            emitsticky();
            ldb.set('stickylist', newValue);
        });
        return setplaying(plobj.status.playing);
    },
    
    //sets the current song and returns song object
    nextsong: function (){
        return setplaying(plobj.status.playing + 1);
    },

    //sets the current song and returns song object
    prevsong: function (){
        return setplaying(plobj.status.playing - 1);
    },
    
    //sets the current song and returns song object
    playsong: function (p){
        return setplaying(p);
    },
        
    addandplay: async function (link){
        var lpos = plobj.status.playing+1;
        if (isStation(link)){
            plobj.randylist.splice(lpos, 0, await getMeta(link));
            return setplaying(lpos);
        } else if (isStream(link)){
            plobj.randylist.splice(lpos, 0, await getMeta(link));
            return setplaying(lpos);
        } else if (fs.statSync(link).isDirectory()){
            plobj.randylist = [];
            var alb = this.getAlbum(link).files;
            for (var i = 0; i < alb.length; i++){
                plobj.randylist.push(await getMeta(alb[i].path));
            }
            return setplaying(0);  
        } else {
            plobj.randylist.splice(lpos, 0, await getMeta(link));
            return setplaying(lpos);
        }
    },
    
    addlast: async function (link){
        if (isStream(link) || isStation(link)){
            plobj.randylist.push(await getMeta(link));
        } else if (fs.statSync(link).isDirectory()){
            var alb = this.getAlbum(link).files;
            for (var i = 0; i < alb.length; i++){
                plobj.randylist.push(await getMeta(alb[i].path));
            } 
        } else {
            plobj.randylist.push(await getMeta(link));
        }
        return setplaying(plobj.status.playing);
    },
    
    addtosticky: async function (link){
        var obj = null;
        if (isStream(link) || isStation(link)){
            var met = await getMeta(link);
            obj = {name:met.tags.common.title + ' [stream]', path:link};
        } else if (fs.statSync(link).isDirectory()){
            var pp = path.parse(link);
            obj = {name:pp.base, path:link};
        } else {
            var met = await getMeta(link);
            obj = {name:met.tags.common.title, path:link};
        }
        //check dup
        for (var i = 0; i < plobj.stickylist.length; i++){
            if (plobj.stickylist[i].path == obj.path){
                plobj.stickylist.splice(i, 1);
            }
        }
        plobj.stickylist.unshift(obj);
    },

    removesticky: async function (link){
        //find the entry
        for (var i = 0; i < plobj.stickylist.length; i++){
            if (link.hasOwnProperty('path')){
                if (plobj.stickylist[i].path.path == link.path){
                    plobj.stickylist.splice(i, 1);
                }
            }
            if (plobj.stickylist[i].path == link){
                plobj.stickylist.splice(i, 1);
            }
        }
    }
};

//util functions//
function setplaying(p){
    //check for edge case
    if (p < 0){
        plobj.status.playing = 0; 
    } else if (p >= (plobj.randylist.length - 1)){ 
        plobj.status.playing = plobj.randylist.length - 1; 
    } else {
        plobj.status.playing = p;
    }
    //save status
    sdb.set('status', plobj.status);
    //check if we need to add a new random
    addNewRandomSong();
    return plobj.randylist[plobj.status.playing];
}

function isdup(obj,arr){
    for (var i=0; i<arr.length; i++){
        if (arr[i] == null){
            return true;
        }
        if (!arr[i].hasOwnProperty('songfile')){
            return true;
        }
        if (arr[i].songfile == obj){
            return true;
        }
    }
    return false;
}

async function initRlist(){
    var rlist = [];
    var howmanyproblems = 0;
    var howmanyleft = 0;
    if (allsongs.length > Numofnextsongs){
        while (howmanyleft < Numofnextsongs){
            var newso = await getnewrsong(allsongs,rlist);
            if (newso !== null){
                rlist.push(newso);
                howmanyleft++;
                howmanyproblems--;
            } else {
                //prevent it going into endless loops
                howmanyproblems++;
                howmanyleft++;
                //show error message to users
                if (howmanyproblems >= Numofnextsongs){
                    Emitproblem();
                }
            }
        }
    }
    return rlist;
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
}

function getnewrsong(arr,rarr){  
    return new Promise(function(resolve, reject) {
        var alen = arr.length;
        var rs = arr[getRandomInt(0,alen)];
        while (isdup(rs,rarr) && alen > rarr.length){
            rs = arr[getRandomInt(0,alen)];
        }
        console.log("New random song: " + path.basename(rs));
        getMeta(rs).then(function(t){
           resolve(t); 
        });
    });
}

async function cacheAllSongs(){
    console.log("Caching allsongs");
    for (var i=0; i<allsongs.length; i++){
        //getMeta(rs);
        getMeta(allsongs[i]);
    }
}

function getRadios(keyword){
    return new Promise(function(resolve, reject) {
        //http://www.radio-browser.info/webservice/json/stations/search - old api
        needle.post('https://de1.api.radio-browser.info/json/stations/search',
            {
                name: keyword,
                limit: 8
            }, 
            { json: true }, (err, res) => {
                if (err) {
                    console.error("getRadio error: " + err);
                    resolve([]);
                };
                console.log("found " + res.body.length + " radios");
                var arr = [];
                for (var i=0; i<res.body.length; i++){
                    var radio = res.body[i];
                    //console.log("radio: " + JSON.stringify(radio));
                    arr.push({ name:radio.name, 
                                album:radio.country + " - " + radio.language, 
                                path:{path:radio.url, site:radio.homepage, id:radio.stationuuid}});
                }
                console.log("radios: " + JSON.stringify(arr));
                resolve(arr);
        });
    });
}

function getRadio(id){
    return new Promise(function(resolve, reject) {
        //http://www.radio-browser.info/webservice/json/url/'+id, - old api
        console.log("radio link " + 'https://de1.api.radio-browser.info/json/stations/byuuid/'+id);
        needle.post('https://de1.api.radio-browser.info/json/stations/byuuid/'+id,
            {},{ json: true }, (err, res) => {
                if (err) {
                    console.error("getRadio error: " + err);
                    resolve({});
                };
                //console.log("radio obj " + JSON.stringify(res.body[0]));
                resolve(res.body[0]);
        });
    });
}

function getMeta(rs){
    console.log("getting metadata for " + JSON.stringify(rs));
    return new Promise(function(resolve, reject) {
        //resolve if null
        if (!rs){
            resolve(null);
        }
        if (cdb.has(rs)){
            //console.log("metadata exists");
            resolve(cdb.get(rs));
        } else if (isStation(rs)){
            console.log("metadata for station");
            getRadio(rs.id).then(function (robj){
                //console.log("got meta for radio " + JSON.stringify(robj));
                var mobj = {songfile: rs.path,
                    type:"radio",
                    tags:{ 
                        common:{
                            artist:robj.country + " - " + robj.language ,
                            title:robj.name,
                            album:""
                        }
                    },
                    albumart:robj.favicon
                };
                cdb.set(rs.path,mobj);
                resolve(mobj);
            });
        } else if (isStream(rs)){ //stream
            console.log("metadata for stream");
            isAudioStream(rs).then(function(rtn){
                console.log('is it an audio stream? - ' + rtn);
                if (rtn){
                    console.log("got meta for Audio Stream URL: " + rs);
                    var mobj = {songfile: rs,
                                type:"stream",
                                tags:{ 
                                    common:{
                                        artist:"Audio Stream",
                                        title:rs,
                                        album:""
                                    }
                                },
                                albumart:""
                            };
                    cdb.set(rs,mobj);
                    resolve(mobj);
                } else {
                    metaget.fetch(rs, function (err, meta_response) {
                        //save to db
                        var meta = getBestMetaData(meta_response, rs);
                        var mobj = {songfile: rs,
                            type:"stream",
                            tags:{ 
                                common:{
                                    artist:meta.artist,
                                    title:meta.title,
                                    album:meta.album
                                }
                            },
                            albumart:meta.image
                            };
                        cdb.set(rs,mobj);
                        if(err){
                            console.log("Error getting url metadata - " + err);
                            resolve({"success":false,"err":err,"results":null});
                        } else {
                            //return
                            console.log("got meta for stream: " + meta_response);
                            resolve(mobj);
                        }
                    });
                }
            });
        } else if (!fs.existsSync(rs)){ //file check if exists
            console.log('File doesnt exist - ' + rs);
            resolve(null);
        } else { //file exists
            mm.parseFile(String(rs),{skipCovers:true})
              .then(function (metadata) {
                var pp = path.parse(rs);
                if (!metadata.common.hasOwnProperty('title')){
                    metadata.common.title = pp.name;
                }
                if (!metadata.common.hasOwnProperty('artist')){
                    metadata.common.artist = pp.name;
                }
                if (!metadata.common.hasOwnProperty('album')){
                    metadata.common.album = pp.dir.split(path.sep).pop();
                }
                var cov = checkFolderAlbumArt(rs);
                if (cov !== null){ //check folder album art first
                    var mobj = {songfile:rs,
                                type:"file",
                                tags:{ 
                                    format:{
                                        duration:metadata.format.duration
                                    },
                                    common:{
                                        artist:metadata.common.artist,
                                        title:metadata.common.title,
                                        album:metadata.common.album
                                    }
                                },
                                albumart:cov};
                    cdb.set(rs,mobj);
                    resolve(mobj);
                } else { //check online version
                    console.log('looking for album cover online')
                    console.log('artist - ' + metadata.common.artist.split(',')[0]);
                    console.log('album - ' + metadata.common.album);
                    albumArt(metadata.common.artist.split(',')[0], {album:metadata.common.album, size:"mega"} , ( error, response ) => {
                        console.log('--- got cover - ' + response);
                        if (error != null){
                            console.log('--- got error - ' + error);
                        }
                        var mobj = {songfile:rs,
                                    type:"file",
                                    tags:{ 
                                        format:{
                                            duration:metadata.format.duration
                                        },
                                        common:{
                                            artist:metadata.common.artist,
                                            title:metadata.common.title,
                                            album:metadata.common.album
                                        }
                                    },
                                    albumart:response};
                        cdb.set(rs,mobj);
                        resolve(mobj);
                    });
                }
              })
              .catch(function (err) {
                console.error("Error getting file metadata - " + err.message);
                console.error("- for file:" + rs);
                resolve(null);
              });
        }
    });
}

function checkFolderAlbumArt(rs){
    var pp = path.parse(rs);
    var cov = path.join(pp.dir,"cover.jpg");
    var covpath = path.join("/mnt",cov.replace(settings.musicfolders,""));
    if (fs.existsSync(cov)){
        //console.log("gotcover: " + covpath);
        return covpath;
    } else {
        //console.log("no cover: " + cov);
        return null;
    }
}

function getBestMetaData(meta, link){
    if (meta.hasOwnProperty('og:title')){
        meta.title = meta['og:title'];
    } else if (!meta.hasOwnProperty('title')){
        meta.title = link;
    }

    if (meta.hasOwnProperty('og:description')){
        meta.description = meta['og:description'];
    } else if (!meta.hasOwnProperty('description')){
        meta.description = "";
    } 

    if (meta.hasOwnProperty('og:image')){
        meta.image = meta['og:image'];
    } else if (!meta.hasOwnProperty('image')){
        meta.image = "";
    }

    if (meta.hasOwnProperty('og:site_name')){
        meta.artist = meta['og:site_name'];
    } else {
        meta.artist = "";
    }

    meta.album = "";
    return meta;
}

function isStation(link){
    if (!link){
        return false;
    }
    return (link.hasOwnProperty('site'));
}

function isStream(link){
    if (!link){ return false};
    if (typeof link == 'string'){
        var purl = url.parse(link);
        return ((purl.protocol !== null && purl.host !== null));
    } else {
        return false;
    }
}

function isAudioStream(link){
    return new Promise(function(resolve, reject) {
        console.log('isAudioStream');
        if (!link){ return false };
        var need = needle.get(link, {open_timeout: 3000, follow_max: 3});
        need.on('header', function(status, headers) {
            console.log(headers);
            //return
            if (!headers.hasOwnProperty('content-type')){
                resolve(false);
            } else {
                resolve(headers['content-type'].startsWith('audio') || 
                        filetypesarr.some(v => headers['content-type'].includes(v.substring(1))));
            }
        });
        need.on('timeout', function(status) {
            console.log('time out');
            resolve(false);
        });
    });
}

async function addNewRandomSong(){
    var howmanyleft = (plobj.randylist.length - plobj.status.playing - 1);
    var howmanyproblems = 0;
    while (howmanyleft < Numofnextsongs && allsongs.length > Numofnextsongs){
        var newso = await getnewrsong(allsongs,plobj.randylist);
        if (newso !== null){
            plobj.randylist.push(newso);
            if (plobj.randylist.length > Maxrandhistory){
                plobj.randylist.shift();
                plobj.status.playing--;
            }
            howmanyleft++;
            howmanyproblems--;
        } else {
            //prevent it going into endless loops
            howmanyproblems++;
            howmanyleft++;
            //show error message to users
            if (howmanyproblems >= Numofnextsongs){
                Emitproblem();
            }
        }
    }
}