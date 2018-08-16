// =========================================================
// Random player playlist utils
// built by : Gideon Simons, 2018
// =========================================================

//dependancies
var fs = require('fs');
var path = require('path');
var url = require('url');
var JSONdb = require('simple-json-db');
var find = require('find');
var FileHound = require('filehound');
var WatchJS = require("melanke-watchjs");
var mm = require('music-metadata');
var util = require('util');
var albumArt = require( 'album-art' );
var metaget = require("metaget");

//-- Databases --//
//all songs
var adb = new JSONdb(path.join(__dirname, '..', '/DB/adb.json'));
//status
var sdb = new JSONdb(path.join(__dirname, '..', '/DB/sdb.json'));
//playlist
var pdb = new JSONdb(path.join(__dirname, '..', '/DB/pdb.json'));
//sticky
var ldb = new JSONdb(path.join(__dirname, '..', '/DB/ldb.json'));
//coverart
var cdb = new JSONdb(path.join(__dirname, '..', '/DB/cdb.json'));

var watch = WatchJS.watch;
var unwatch = WatchJS.unwatch;
var allsongs = [];
var stickylist = [];
var randylist = [];
var status = {
    playing:0,
    seek:0,
    playlist:null,
    musicfolder:"/Users/gideonsimons/Documents/whatgot/"
}
var Numofnextsongs = 5;
var Maxrandhistory = 50;
//const filetypes = /\.(?:wav|mp3|flac|mpa|aac|oga|pls|ape|aif|aiff|aifc|asf|wma|m4a|m4b|m4p|m4v|m4r|mp4|mp2|m2a|ogv|oga|ogx|ogg|opus|wv|wvp)$/i;//removed m3u
var filetypesarr = [".wav", ".mp3", ".flac", ".mpa", ".aac", ".oga", 
                    ".pls", ".ape", ".aif", ".aiff", ".aifc", ".asf", 
                    ".wma", ".m4a", ".m4b", ".m4p", ".m4v", ".m4r", 
                    ".mp4", ".mp2", ".m2a", ".ogv", ".oga", ".ogx", 
                    ".ogg", ".opus", ".wv", ".wvp"];

//var musicfolder = "/Users/gideonsimons/Documents/whatgot/";
var musicfolder = "/media/usb";
//var musicfolder = "/media/nas";

//expose the main function
module.exports = {
    
    setMusicFolder: function(mf) {
        musicfolder = mf;
    },
    
    getAllSongs: function(){
        
        return new Promise(function(resolve, reject) {
            
            //check if already saved
            if (adb.has('allsongs')){
                var alls = adb.get('allsongs');
                if (alls.songs.length > 0){
                    allsongs = alls.songs;
                    resolve();
                }
            }
            
            filehound = FileHound.create();
            filehound
              .path(musicfolder)
              .ext(filetypesarr)
              .ignoreHiddenDirectories()
              .ignoreHiddenFiles()
              .find();

            filehound.find((err, files) => {
                if (err){
                    return console.error("filehound error: " + err);
                }
                allsongs = files;
                adb.set('allsongs', {folder:musicfolder,songs:allsongs});
                resolve();
            });
            /*
            //look into the music folder
            find.file(filetypes, musicfolder, function(files) {
                //console.log(JSON.stringify(files,2));
                allsongs = files;
                adb.set('allsongs', {folder:musicfolder,songs:allsongs});
                resolve();
            });
            */
        });
        
    },
    
    getStickyList: function (limit){
        var temparr = [];
        var len = limit;
        if (stickylist.length < limit || !limit){
            len = stickylist.length;
        }
        for (i=0; i<len; i++){
            temparr.push({name:stickylist[i].tags.common.title,path:stickylist[i].songfile});
        }
        return temparr;
    },
    
    searchSongs: function(keyword){
        var rtn = {albums:[],files:[]};
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
        console.log("- files: " + rtn.files.length + " , albums: " + rtn.albums.length);
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
    
    getRandomAlbums: function(l){
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
            rtn.albums.push(temparr.splice(getRandomInt(0, (temparr.length - 1)), 1)[0]);
            limit++;
        }
        return rtn;
    },
    
    getPlayList: function(){
        return randylist;
    },
    
    getNextsPlayList: function(){
        return randylist.slice((status.playing+1));
    },
    
    getCurrentSong: function(){
        return randylist[status.playing];
    },
    
    getPlaying: function(){
        return status.playing;
    },
    
    //create a new random playlist
    initPlaylist: async function (num){
        Numofnextsongs = num;
        //check if already saved
        if (pdb.has('playlist')){
            randylist = pdb.get('playlist');
        } else {
            randylist = await initRlist();
            pdb.set('playlist', randylist);
        }
        if (sdb.has('status')){
            status = sdb.get('status');
        } else {
            sdb.set('status',status);
        }
        if (ldb.has('stickylist')){
            stickylist = ldb.get('stickylist');
        }
        //set watchers
        watch(randylist, function(){
            //console.log("randylist changed");
            pdb.set('playlist', randylist);
        });
        watch(stickylist, function(){
            //console.log("stickylist changed");
            ldb.set('stickylist', stickylist);
        });
        watch(status, function(){
            sdb.set('status', status);
            //console.log("status changed");
        });
        return randylist[status.playing];
    },
    
    //sets the current song and returns song object
    nextsong: function (){
        return setplaying(status.playing + 1);
    },

    //sets the current song and returns song object
    prevsong: function (){
        return setplaying(status.playing - 1);
    },
    
    //sets the current song and returns song object
    playsong: function (p){
        return setplaying(p);
    },
        
    addandplay: function (link){
        return new Promise(function(resolve, reject) {
            getMeta(link).then(function(met){
                randylist.splice((status.playing+1), 0, met);
                resolve(setplaying((status.playing+1)));
            });
        });
    },
    
    addlast: function (link){
        return new Promise(function(resolve, reject) {
            getMeta(link).then(function(met){
                randylist.push(met);
                resolve(setplaying(status.playing));
            });
        });
    },
    
    addtosticky: function (link){
        getMeta(link).then(function(t){
            stickylist.push(t);
        }); 
    }
};

//util functions//

function setplaying(p){
    //check for edge case
    if (p < 0){
        status.playing = 0; 
    } else if (p >= (randylist.length - 1)){ 
        status.playing = randylist.length - 1; 
    } else {
        status.playing = p;
    }
    //check if we need to add a new random
    addNewRandomSong();
    return randylist[status.playing];
}

function isdup(obj,arr){
    for (var i=0; i<arr.length; i++){
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
    while (rlist.length < Numofnextsongs){
        rlist.push(await getnewrsong(allsongs,rlist));
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
        //console.log("Finding a new random song.");
        while (isdup(rs,rarr) && alen > rarr.length){
            rs = arr[getRandomInt(0,alen)];
        }
        console.log("New random song: " + path.basename(rs));
        getMeta(rs).then(function(t){
           resolve(t); 
        });
    });
}

function getMeta(rs){
    return new Promise(function(resolve, reject) {
        if (isStream(rs)){ //stream
            metaget.fetch(rs, function (err, meta_response) {
                if(err){
                    console.log("Error getting url metadata - " + err);
                    resolve({"success":false,"err":err,"results":null});
                } else {
                    //return
                    resolve({songfile:rs,
                             type:"stream",
                             tags:{ 
                                 common:{
                                     artist:meta_response['og:site_name'],
                                     title:meta_response['og:title'],
                                     album:""
                                 }
                             },
                             albumart:meta_response["og:image"]
                            });
                }
            });
        } else { //file
            mm.parseFile(rs,{skipCovers:true})
              .then(function (metadata) {
                albumArt(metadata.common.artist, {album:metadata.common.album, size:"mega"} , ( error, response ) => {
                    //console.log("albumart from lastfm : " + response);
                    //console.log(util.inspect(metadata, { showHidden: false, depth: null }));
                    resolve({songfile:rs,type:"file",tags:metadata,albumart:response});
                });
              })
              .catch(function (err) {
                console.error("Error getting file metadata - " + err.message);
                console.error("- for file:" + rs);
                resolve(null);
              });
        }
        
        
    });
}

function isStream(link){
    var purl = url.parse(link);
    return (purl.protocol !== null && purl.host !== null);
}

async function addNewRandomSong(){
    var howmanyleft = (randylist.length - status.playing - 1);
    while (howmanyleft < Numofnextsongs){
        var newso = await getnewrsong(allsongs,randylist);
        if (newso !== null){
            randylist.push(newso);
            if (randylist.length > Maxrandhistory){
                randylist.shift();
                status.playing--;
            }
            howmanyleft++;
        }
    }
}