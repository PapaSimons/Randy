// ==============================================
// Randy POC
// built by : Gideon Simons, 2018
// ==============================================

//consol log with timestamp
require('console-stamp')(console, { pattern: 'dd/mm/yyyy HH:MM:ss' });

//dependencies
var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var bodyParser = require('body-parser');
var playlist = require('./lib/playlist_utils.js');
var createPlayer = require('./lib/mpv-wrapper');
var metaget = require("metaget");
var cp = require('child_process');
var observe = require('smart-observe');
var fs = require("fs");

//vars
var player = null;
var psocket = null;
var port = process.env.PORT || 8888;
var isloaded = false;
var sockettimeout = null;
var seekable = true;

//express parsing support
app.use(bodyParser.json()); // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({
    extended: true
})); // to support URL-encoded bodies

///--- Public web ui folder ---///

app.use("/", express.static(__dirname + "/public"));

///--- APIs Exposed ---///

//POST 
app.post('/getStickyList', function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    //return
    res.json({"results":playlist.getStickyList(req.body.limit)});
});

app.post('/getAlbums', function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    //return
    res.json({"results":playlist.getAlbums(req.body.limit)});
});

app.post('/getAlbum', function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    //return
    console.log("get album: " + req.body.albumdir);
    res.json({"results":playlist.getAlbum(req.body.albumdir)});
});

app.post('/getRandomAlbums', function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    //return
    console.log();
    playlist.getRandomAlbums(req.body.limit).then(function(results){
        res.json({"results":results});
    });
    
});

app.post('/setMusicFolder', function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    console.log("setting music folders to: " + req.body.mf);
    //return
    playlist.setMusicFolder(req.body.mf).then(function(fsong){
        initmf(req.body.mf);
        playsong(fsong);
        res.json({"success":200});
    }, function (err){
        res.json({"success":err});
    });
    
});

app.post('/searchSongs', function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    //return
    console.log("searching with keyword: " + req.body.keyword);
    playlist.searchSongs(req.body.keyword).then(function(rtn){
        res.json({"results":rtn});
    });
});

app.post('/getURLMeta', function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    metaget.fetch(req.body.url, function (err, meta_response) {
        if(err){
            console.log("url metadata error: " + err);
            res.json({"success":false,"err":err,"results":null});
        }else{
            console.log(meta_response);
            //return
            res.json({"success":true,
                      "title":meta_response['og:title'],
                      "description":meta_response['og:description'],
                      "img":meta_response["og:image"]});
        }
    });
    
});

//IO
io.on('connection', function(socket){
    
    psocket = socket;
    
    console.log('a user connected');
    
    //check initial settings
    if (!checkmf()){
        io.sockets.emit('nomusicfolder', null);
    }
    
    if (playlist.getPlayList().length > 0){
        psocket.emit('playlist', {playlist:playlist.getPlayList(), playing:playlist.getPlaying()});
        var curs = playlist.getCurrentSong();
        psocket.emit('nowplaying', {title:curs.tags.common.title, albumart:curs.albumart});
    }
    
    socket.on('play', function(msg){
      console.log('play');
      player.play();
    });

    socket.on('pause', function(msg){
      console.log('pause');
      player.pause();
    });

    socket.on('next', function(msg){
      console.log('next');
      playsong(playlist.nextsong());
    });

    socket.on('prev', function(msg){
      console.log('prev');
      playsong(playlist.prevsong());
    });
    
    socket.on('playsong', function(msg){
      console.log('playsong - ' + msg);
      playsong(playlist.playsong(msg));
    });
    
    socket.on('seek', function(msg){
      console.log('seek - ' + msg);
      player.seek(msg, 'absolute');
    });
    
    socket.on('playnow', function(msg){
      console.log('playnow - ' + msg);
      playlist.addandplay(msg).then(function(p){
          playsong(p);
      });
    });
    
    socket.on('addtolist', function(msg){
      console.log('addtolist - ' + msg);
      playlist.addlast(msg);
    });
    
    socket.on('stick', function(msg){
      console.log('stick - ' + msg);
      playlist.addtosticky(msg);
    });
    
    socket.on('randy', function(msg){
      console.log('randy');
      playlist.randy().then(function(p){
          playsong(p);
      }); 
    });
    
});

//--- start server ---///

http.listen(port, function(){
    console.log("Randy on port " + port);
  });
  
console.log("Welcome to Randy - localhost:8888 - !");
  
////--- init the player ---////

function initRandy(){
    //kill previous mpv instances
    killmpv();
    //check music folder
    if (!checkmf()){
        console.log("No music folder found");
        io.sockets.emit('nomusicfolder', null);
    } else {
        //for serving cover art files (potentially streaming in future)
        initmf();
        //load playlist
        playlist.getAllSongs().then(function(){
            playlist.initPlaylist(3).then(function(fsong){
                //watch the playlist
                observe(playlist.getPlobj(),'randylist', function(n,o){
                    console.log('playlist changed ' + playlist.getPlaying());
                    io.sockets.emit('playlist', {playlist:playlist.getPlayList(), playing:playlist.getPlaying()});
                });
                if (player != null){
                    //console.log("initPlaylist - loading first song - " + fsong.songfile);
                    playsong(fsong); 
                }
            }).then(function(err){
               //console.log("error while initing playlist - " + err); 
            });
        }).then(function(err){
           //console.log("error while getting all songs - " + err); 
        });
    }
    //create the player instance
    createNewPlayer();
}

initRandy();   

//kill mpv when nodejs exits
process.on('SIGINT', function() {
    killmpv();
    process.exit(0);
});

//keep nodejs alive
process.on('uncaughtException', function (err) {
    console.log(err);
}); 

function createNewPlayer(){
    //create player instance
    //createPlayer(['--no-video']).then(function(newplayer){
    createPlayer({ args: ['--af-clr','--vf-clr','--vid=no'] }, (err, newplayer) => {
        if (err) {
            console.error("Error creating player - " + err);
        } else {
            console.log("New mpv player started on Idle");
            player = newplayer;
            //load the current song
            if (playlist.getPlayList().length > 0){
                playsong(playlist.getCurrentSong());
            }
            //listen to events
            player.observeProperty('audio-pts', function(t){
                io.sockets.emit('pos', t);
            });
            player.observeProperty('seekable', function(t){ 
                //console.log('seekable: ' + t);
                seekable = t;
            });
            player.observeProperty('duration', function(t){
                if (seekable){
                    io.sockets.emit('duration', t);
                }
            });
            //player.observeProperty('audio-params', t => console.log('audio-params: ' + JSON.stringify(t)));
            player.observeProperty('media-title', function(t){
                isloaded = true;
                if (t != null){
                    var curs = playlist.getCurrentSong();
                    console.log('Title changed: ' + t);
                    io.sockets.emit('nowplaying', {title:t,albumart:curs.albumart});
                }
            });
            player.observeProperty('metadata', function(t){
                //console.log('metadata: ' + JSON.stringify(t));
                if (t !== null){
                    if (t.hasOwnProperty("icy-title")){
                        console.log('Title changed: ' + t["icy-title"]);
                        var curs = playlist.getCurrentSong();
                        var al = curs.tags.common.artist;
                        if (t.hasOwnProperty("icy-name")){
                            al += " - " + t["icy-name"];
                        } else {
                            al += " - " + curs.tags.common.title;
                        }
                        io.sockets.emit('nowplaying', {title:t["icy-title"], album:al , albumart:curs.albumart});
                    }
                }
            });
            //player.observeProperty('AV', t => console.log('Audio specs: ' + t));
            //player.observeProperty('A', t => console.log('Player info: ' + t));
            //when mpv is idle
            //testing alternative to end of file with idle
            player.onIdle(() => {
                console.log('idle - loading next song');
                playsong(playlist.nextsong());
            });
            /*
            //finished playing a file
            player.onEndFile(() => {
                ////doesnt work very well
            });
            */
        }	
    });  
}

function killmpv(){
    cp.spawnSync('killall',['mpv']);
}

function restartplayer(){
    console.log("restarting mpv");
    killmpv();
    createNewPlayer();
}

function checkmf(){
    var mf = playlist.getSettings().musicfolders;
    if (mf == null){ 
        return false;
    }
    for (i = 0; i < mf.length; i++){
        if (!fs.existsSync(mf[i])){
            return false;
        }
    }
    return true;
}

function initmf(){
    var mf = playlist.getSettings().musicfolders;
    for (i = 0; i < mf.length; i++){
        app.use("/mnt/", express.static(mf[i]));
    }
}

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
} 

async function playsong(songobj){
    if (songobj !== null){
        //check if mpv is alive
        try {
            if (songobj.hasOwnProperty('songfile')){
                //load the file
                console.log("Loading: " + songobj.songfile);
                isloaded = false;
                //test for socket timeout
                clearTimeout(sockettimeout);
                sockettimeout = setTimeout(function() {
                  if (!isloaded){
                      console.log("Player socket timed out");
                      restartplayer();
                  }
                }, 3000);
                await player.loadfile(songobj.songfile, 'replace').then(
                    function (rtn) { isloaded = true; }, 
                    function (err) { console.log('loading file error: ' + err); }
                );
                //unpause
                await player.play();
                //update all players
                io.sockets.emit('playlist', {playlist:playlist.getPlayList(), playing:playlist.getPlaying()});
            }
        } catch(error) {
            console.log("Player is unresponsive, restarting mpv - error: " + error);
            restartplayer();
        }   
    } else {
        console.log("bad songobj + " + JSON.stringify(songobj));
    }
}