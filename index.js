// ==============================================
// Randy Player
// built by : Gideon Simons, 2018-2023
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
var fs = require("fs");
var drivelist = require('drivelist');

//vars
var player = null;
var psocket = null;
var port = process.env.PORT || process.argv[2] || 80;
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
app.post('/powerOff', function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    //return
    console.log("Powering off - see you later!");
    poweroff();
    res.json({"success":200});
});

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

app.post('/getSettings', async function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    //return
    console.log("getting settings");
    var cursettings = playlist.getSettings();
    var drives = await drivelist.list();
    var devices = [];
    drives.forEach((drive) => {
        if (drive.mountpoints.length > 0 && drive.isUSB){
            if (drive.mountpoints.length > 1){
                var ind = 1;
                drive.mountpoints.forEach((mountpoint) => {
                    var device = {"name":drive.description + ' | partition ' + ind, "size":drive.size, "path":mountpoint.path};
                    devices.push(device);
                    ind++;
                });
            } else {
                var device = {"name":drive.description, "size":drive.size, "path":mountpoints[0].path};
                devices.push(device);
            }   
        }
    });
    res.json({"cursettings":cursettings, "devices":devices});
});

app.post('/getURLMeta', function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    console.log('Checking audio stream for: ' + req.body.url);
    playlist.checkAudioStream(req.body.url).then(function(rtn){
        console.log('is it an audio stream? - ' + rtn);
        if (rtn){
            res.json({"success":true,
                      "title":req.body.url,
                      "description":'Audio Stream',
                      "img":''});
        } else {
            console.log('Getting metadata for: ' + req.body.url);
            metaget.fetch(req.body.url, function (err, meta_response) {
                if(err){
                    console.log("url metadata error: " + err);
                    res.json({"success":false,"err":err,"results":null});
                }else{
                    console.log(meta_response);
                    var meta = playlist.getBestMeta(meta_response, req.body.url);
                    //return
                    res.json({"success":true,
                              "title":meta.title,
                              "description":meta.description,
                              "img":meta.image});
                }
            });
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

    socket.on('unstick', function(msg){
        console.log('unstick - ' + msg);
        playlist.removesticky(msg);
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
  
console.log("Welcome to Randy - localhost:" + port + " - !");
  
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
            playlist.initPlaylist(3,emitplaylist,emitsticky).then(function(fsong){
                if (player != null){
                    playsong(fsong); 
                }
            }).catch(function(err){
               console.log("error while initing playlist - " + err); 
            });
        }).catch(function(err){
           console.log("error while getting all songs - " + err); 
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

//emit playlist
function emitplaylist(){
    console.log('playlist changed ' + playlist.getPlaying());
    io.sockets.emit('playlist', {playlist:playlist.getPlayList(), playing:playlist.getPlaying()});
}

function emitsticky(){
    io.sockets.emit('newstickies', {});
}

function createNewPlayer(){
    //create player instance
    createPlayer({ args: ['--no-config', '--af-clr','--vf-clr','--vid=no','--no-video', 'script-opts=ytdl_hook-ytdl_path=yt-dlp',
                          '--audio-display=no','--no-initial-audio-sync','--ytdl-format=bestaudio'] }, (err, newplayer) => {
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
            player.observeProperty('audio-out-params', function(t){
                if (t && t != null){
                    console.log('audio-out-params: ' + JSON.stringify(t))
                }
            }); 
            player.observeProperty('audio-device', function(t){
                if (t && t != null){
                    console.log('audio-device: ' + JSON.stringify(t))
                }
            }); 
            player.observeProperty('media-title', function(t){
                isloaded = true;
                if (t && t != null){
                    var curs = playlist.getCurrentSong();
                    console.log('Title changed: ' + t);
                    //console.log(JSON.stringify(curs));
                    io.sockets.emit('nowplaying', {title:curs.tags.common.title, albumart:curs.albumart});
                }
            });
            player.observeProperty('metadata', function(t){
                if (t && t !== null){
                    if (t.hasOwnProperty("icy-title")){
                        console.log('Title changed: ' + t["icy-title"]);
                        var curs = playlist.getCurrentSong();
                        var al = curs.tags.common.artist;
                        var tt = curs.tags.common.title;
                        if (t["icy-title"] != ""){
                            tt = t["icy-title"];
                        }
                        if (al == tt){
                            al = "Radio stream";
                        } else if (t.hasOwnProperty("icy-name")){
                            al = t["icy-name"];
                        } else if (al == "") {
                            al = "Radio stream";
                        }
                        io.sockets.emit('nowplaying', {title:tt, album:al , albumart:curs.albumart});
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

// powers off linux (rpi) //
function poweroff(){
    cp.spawnSync('poweroff');
}

// kills any mpv processes (linux/mac) //
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
    //console.log("songobj - " + JSON.stringify(songobj));
    if (songobj && songobj !== null){
        //check if mpv is alive
        try {
            console.log("Loading: " + songobj.songfile);
            if (songobj.hasOwnProperty('songfile')){
                //load the file
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