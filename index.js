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
var createPlayer = require('./lib/player');
var spotifyItem = require('./lib/spotify-item');
var metaget = require("metaget");
var cp = require('child_process');
var fs = require("fs");
//var drivelist = require('drivelist');
const nodeDiskInfo = require('node-disk-info');
const os = require('node:os'); 

//vars
var player = null;
var psocket = null;
var port = process.env.PORT || process.argv[2] || 80;
var selectedPlayer = null;
var playbackId = 0;
var shuttingDown = false;
var playlistInitialized = false;
var readyPlayer = null;
var startupPlaybackPlayer = null;
var audiodevicelist = [];
var playerBackend = process.env.RANDY_PLAYER_BACKEND || 'mpv';
var spotify = require('./lib/spotify')({serverUrl:process.env.LMS_SERVER_URL, playerId:process.env.LMS_PLAYER_ID,
    getSettings:() => playlist.getSettings(), setSetting:(key, value) => playlist.setSetting(key, value)});
var audioOutput = new (require('./lib/squeezelite-output').Output)({playerId:process.env.LMS_PLAYER_ID,
    getSettings:()=>playlist.getSettings(),setSetting:(key,value)=>playlist.setSetting(key,value)});

//express parsing support
app.use(bodyParser.json()); // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({
    extended: true
})); // to support URL-encoded bodies

///--- Public web ui folder ---///

app.use("/", express.static(__dirname + "/public"));
require('./lib/spotify-routes')(app, {spotify, playlist, backend:playerBackend, playSong:playsong, getPlaybackId:() => playbackId, onAccountRemoved:() => io.sockets.emit('spotify-account-removed')});
app.post('/audio-output/list',async function(req,res){
    if(playerBackend!=='lms')return res.json({enabled:false});
    res.json({enabled:true,...await audioOutput.list()});
});
app.post('/audio-output/change',async function(req,res){
    if(playerBackend!=='lms')return res.status(400).json({error:'Squeezelite output selection requires LMS'});
    try{res.json(await audioOutput.change(req.body.id));}
    catch(error){res.status(400).json({error:error.message});}
});
spotify.ownership.on('change', function(event){
    if (playerBackend !== 'lms') return;
    if (event.state === 'spotify_connect') ++playbackId;
    io.sockets.emit('spotify-ownership', event);
});

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
    res.json({"results":playlist.getStickyList(req.body && req.body.limit)});
});

app.post('/getAlbums', function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    //return
    res.json({"results":playlist.getAlbums()});
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
    const devices = await getAllDevices();
    console.log(devices);
    console.log(audiodevicelist);
    var audiodevices = [];
    audiodevicelist.forEach((device) => {
        //add back hw which was removed by mpv
        if (device.name.includes('plughw')){
            var hwname = device.name.replace("plughw","hw");
            var desc = device.description.split('/').splice(0,1).join("/");
            var deviceobj = {"name":hwname, "description":desc + "/ Direct to hardware without conversions", "status":"online"};
            audiodevices.push(deviceobj);
        }
        var deviceobj = {"name":device.name, "description":device.description, "status":"online"};
        audiodevices.push(deviceobj);
    });
    console.log(audiodevices);
    res.json({"cursettings":cursettings, "devices":devices, "audiodevices":audiodevices});
});

app.post('/setSetting', async function (req, res) {
    res.header("Access-Control-Allow-Origin", "http://localhost");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    //return
    console.log("setting a new setting + " + req.body.obj + " = " + req.body.key);
    playlist.setSetting(req.body.obj, req.body.key);
    if (req.body.obj == "audioOutputDevice" || req.body.obj == "replayGain"){
        restartplayer();
    }
    res.json({"success":200});
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

    if (playerBackend === 'lms' && player) {
        var connectionPlayer = player;
        connectionPlayer.getStatus().then(function(status){
            if (player !== connectionPlayer) return;
            if (!status.connectionState) return;
            socket.emit('player-connection', {backend:'lms', state:status.connectionState, connected:status.connected});
            if (!status.connected) socket.emit('problem', {});
        });
    }

    //volume
    io.sockets.emit('volume', playlist.getVolume());
    
    //check if there is a playlist or music folder
    if (!checkmf() && (!playlist.getPlayList().length > 0)){
        io.sockets.emit('nomusicfolder', null);
    }
    
    if (playlist.getPlayList().length > 0){
        psocket.emit('playlist', {playlist:playlist.getPlayList(), playing:playlist.getPlaying()});
        var curs = playlist.getCurrentSong();
        if (spotifyItem.isSong(curs)) emitLMSNowPlaying(null, curs, psocket);
        else psocket.emit('nowplaying', {title:curs.tags.common.title, albumart:curs.albumart});
        replayLMSStatus(socket);
    }
    
    socket.on('play', async function(msg){
      console.log('play');
      if (playerBackend === 'lms' && spotify.ownership.isConnectActive()) return spotify.ownership.remoteControl('play').catch(emitproblem);
      if (playerBackend === 'lms' && (playbackId === 0 || (spotify.ownership.wasConnect && (await player.getStatus()).playbackId == null))) playsong(playlist.getCurrentSong());
      else player.play();
    });

    socket.on('pause', function(msg){
      console.log('pause');
      if (playerBackend === 'lms') spotify.ownership.cancelPending();
      player.pause();
    });

    socket.on('next', function(msg){
      console.log('next');
      if (playerBackend === 'lms' && spotify.ownership.isConnectActive()) return spotify.ownership.remoteControl('next').catch(emitproblem);
      playsong(playlist.nextsong());
    });

    socket.on('prev', function(msg){
      console.log('prev');
      if (playerBackend === 'lms' && spotify.ownership.isConnectActive()) return spotify.ownership.remoteControl('prev').catch(emitproblem);
      playsong(playlist.prevsong());
    });
    
    socket.on('playsong', function(msg){
      console.log('playsong - ' + msg);
      playsong(playlist.playsong(msg));
    });
    
    socket.on('seek', function(msg){
      console.log('seek - ' + msg);
      player.seek(msg);
    });

    socket.on('volume', async function(msg){
      console.log('volume - ' + msg);
      setVolume(parseInt(msg));
      playlist.setVolume(parseInt(msg));
      io.sockets.emit('volume', msg);
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
console.log("Running on - " + os.platform());
  
////--- init the player ---////

// Player discovery and library loading finish independently. Start the persisted
// Randy item once both are ready, regardless of the previous playback owner.
function playCurrentSongOnStart(){
    if (shuttingDown || !playlistInitialized || !readyPlayer || selectedPlayer !== readyPlayer ||
        startupPlaybackPlayer === readyPlayer) return;
    startupPlaybackPlayer = readyPlayer;
    var playonstart = playlist.getSettings().playonstart;
    if (playonstart !== true && playonstart !== 'true' && playonstart != null) return;
    if (!(playlist.getPlayList() || []).length) return;
    console.log('Playing current Randy queue item on start');
    playsong(playlist.getCurrentSong());
}

function initRandy(){
    //check music folder
    if (!checkmf()){
        console.log("No music folder found");
        playlist.initPlaylist(emitplaylist, emitsticky, emitproblem).then(function(fsong){
            playlistInitialized = true;
            playCurrentSongOnStart();
            console.log("initated dbs and objects");
            //check if there is a non musicfolder playlist
            console.log('playlist.getPlayList() - ' + playlist.getPlayList());
            if (playlist.getPlayList() == null){
                io.sockets.emit('nomusicfolder', null);
            }
        }).catch(function(err){
           console.log("error while initing playlist - " + err); 
        });
    } else {
        //for serving cover art files (potentially streaming in future)
        initmf();
        //load playlist
        playlist.getAllSongs().then(function(){
            playlist.initPlaylist(emitplaylist, emitsticky, emitproblem).then(function(fsong){
                playlistInitialized = true;
                playCurrentSongOnStart();
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

// Stop external LMS playback on graceful shutdown; MPV close already kills MPV.
async function shutdown(){
    if (shuttingDown) return;
    shuttingDown = true;
    var currentPlayer = selectedPlayer;
    selectedPlayer = null; // Ignore late completion/reconnect events during cleanup.
    var stopDeadline;
    try {
        if (currentPlayer && playerBackend === 'lms') {
            await Promise.race([
                currentPlayer.stop(),
                new Promise(function(resolve, reject){
                    stopDeadline = setTimeout(function(){ reject(new Error('Timed out stopping LMS playback')); }, 4000);
                })
            ]);
        }
    } catch (error) {
        console.error('Playback shutdown: ' + error.message);
    } finally {
        clearTimeout(stopDeadline);
        try {
            if (currentPlayer) await currentPlayer.close();
        } catch (error) {
            console.error('Player cleanup: ' + error.message);
        }
        process.exit(0);
    }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

//keep nodejs alive
process.on('uncaughtException', function (err) {
    console.log(err);
}); 

//emit playlist
function emitplaylist(){
    console.log('playlist changed ' + playlist.getPlaying());
    io.sockets.emit('playlist', {playlist:playlist.getPlayList(), playing:playlist.getPlaying()});
    replayLMSStatus(io.sockets);
}

// The unchanged frontend rebuilds the current song row on every playlist event.
// Replay cached stats/Spotify metadata afterwards, even when they have not changed.
function replayLMSStatus(target){
    if (playerBackend !== 'lms' || !player) return;
    var currentPlayer = player;
    var currentPlaybackId = playbackId;
    currentPlayer.getStatus().then(function(status){
        if (player !== currentPlayer || playbackId !== currentPlaybackId) return;
        if (spotify.ownership.publish(status, target, true)) return;
        if (status.playbackId !== currentPlaybackId) return;
        if (typeof status.audioStats === 'string') target.emit('audiostats', status.audioStats);
        if (status.seekable && status.duration > 0) target.emit('duration', status.duration);
        if (typeof status.position === 'number') target.emit('pos', status.position);
        if (status.trackMetadata) emitLMSNowPlaying(status, playlist.getCurrentSong(), target);
    });
}

function emitsticky(){
    io.sockets.emit('newstickies', {});
}

function emitproblem(){
    io.sockets.emit('problem', {});
}

function emitLMSNowPlaying(status, song, target){
    target = target || io.sockets;
    var track = status && status.trackMetadata;
    if (!track && spotifyItem.isSong(song)) track = {};
    if (track) {
        var artwork = track.artwork;
        var stored = spotifyItem.isSong(song) ? song.tags.common : {};
        if (spotifyItem.isSong(song)) artwork = spotifyItem.artwork(artwork, song.albumart);
        else if (artwork && artwork.startsWith('/')) artwork = new URL(artwork, process.env.LMS_SERVER_URL || 'http://127.0.0.1:9000').href;
        target.emit('nowplaying', {title:track.title || song.tags.common.title,
            album:[track.artist || stored.artist, track.album || stored.album].filter(Boolean).join(' • ') || song.tags.common.album || '',
            albumart:artwork || song.albumart, ...(spotifyItem.isSong(song) ? {source:'spotify', artist:track.artist || song.tags.common.artist, albumName:track.album || song.tags.common.album} : {})});
        return;
    }
    var metadata = status && status.radioMetadata;
    var nowplaying = {title:metadata && metadata.title || song.tags.common.title, albumart:song.albumart};
    if (metadata) nowplaying.album = metadata.stationName || song.tags.common.title;
    target.emit('nowplaying', nowplaying);
}

async function setVolume(vol) {
    await player.setVolume(vol);
}

function createNewPlayer(){
    if (shuttingDown) return;
    var newplayer = createPlayer({ backend: playerBackend,
        audioOutputDevice: playlist.getSettings().audioOutputDevice,
        serverUrl: process.env.LMS_SERVER_URL, playerId: process.env.LMS_PLAYER_ID,
        observeExternalPlayback:raw => spotify.ownership.observe(raw) });
    selectedPlayer = newplayer;
    // Keep the LMS instance usable after a temporary connection failure; it polls for recovery.
    if (playerBackend === 'lms') player = newplayer;
    newplayer.on('connection-change', function(event){
        if (selectedPlayer !== newplayer || playerBackend !== 'lms') return;
        if (event.playbackId != null && event.playbackId !== playbackId) return;
        console.log('LMS connection: ' + event.state + (event.error ? ' - ' + event.error.message : ''));
        io.sockets.emit('player-connection', {backend:'lms', state:event.state, connected:event.connected});
        if (!event.connected && event.state !== 'closed') { spotify.ownership.disconnected(); emitproblem(); }
    });
    newplayer.on('status', function(status){
        if (selectedPlayer !== newplayer) return;
        if (status.playbackId !== null && status.playbackId !== playbackId) return;
        if (playerBackend === 'lms' && spotify.ownership.publish(status, io.sockets)) return;
        // Keep the existing Socket.IO payloads and MPV metadata presentation.
        status.changed.forEach(function(field){
            switch (field){
                case 'position':
                    io.sockets.emit('pos', status.position);
                    break;
                case 'duration':
                case 'seekable':
                    if (status.seekable) io.sockets.emit('duration', status.duration);
                    break;
                case 'volume':
                    io.sockets.emit('volume', status.volume);
                    break;
                case 'radioMetadata':
                case 'trackMetadata':
                    if (playerBackend === 'lms') emitLMSNowPlaying(status, playlist.getCurrentSong());
                    break;
                case 'audioStats':
                    io.sockets.emit('audiostats', playerBackend === 'lms' ? status.audioStats : status.mpv.audioStats);
                    break;
                case 'mediaTitle':
                    if (status.mpv.mediaTitle){
                        var curs = playlist.getCurrentSong();
                        console.log('Title changed: ' + status.mpv.mediaTitle);
                        io.sockets.emit('nowplaying', {title:curs.tags.common.title, albumart:curs.albumart});
                    }
                    break;
                case 'metadata':
                    var t = status.mpv.metadata;
                    if (t && t.hasOwnProperty('icy-title')){
                        console.log('Title changed: ' + t['icy-title']);
                        var curs = playlist.getCurrentSong();
                        var al = curs.tags.common.artist;
                        var tt = curs.tags.common.title;
                        if (t['icy-title'] != '') tt = t['icy-title'];
                        if (al == tt){
                            al = 'Radio stream';
                        } else if (t.hasOwnProperty('icy-name')){
                            al = t['icy-name'];
                        } else if (al == ''){
                            al = 'Radio stream';
                        }
                        io.sockets.emit('nowplaying', {title:tt, album:al, albumart:curs.albumart});
                    }
                    break;
                case 'audioDevices':
                    console.log('audio-device-list: ' + JSON.stringify(status.mpv.audioDevices));
                    audiodevicelist = status.mpv.audioDevices;
                    break;
                case 'audioOutput':
                    console.log('----- ao --- : ' + status.mpv.audioOutput);
                    break;
            }
        });
    });
    newplayer.on('ended', function(event){
        if (selectedPlayer !== newplayer || event.playbackId !== playbackId) return;
        if (playerBackend === 'lms' && spotify.ownership.getOwnership() !== 'randy') return;
        console.log('idle - loading next song');
        playsong(playlist.nextsong());
    });
    newplayer.on('playback-error', function(event){
        if (selectedPlayer !== newplayer) return;
        if (event.playbackId !== null && event.playbackId !== playbackId) return;
        if (spotifyItem.isSong(playlist.getCurrentSong())) {
            io.sockets.emit('spotify-problem', {message:'Spotify track unavailable or Spotify needs to reconnect'});
        }
        console.log('Player error: ' + event.error);
        if (playerBackend === 'lms') emitproblem();
        if (event.restart) restartplayer();
    });
    newplayer.connect().then(function(){
        if (selectedPlayer !== newplayer) return;
        console.log(playerBackend === 'lms' ? 'LMS adapter initialized; recovery runs in background' : 'New mpv player connected');
        player = newplayer;
        setVolume(playlist.getVolume());
        readyPlayer = newplayer;
        playCurrentSongOnStart();
    }).catch(function(err){
        if (selectedPlayer === newplayer) console.error('Error creating player - ' + err);
    });
}

// powers off linux (rpi) //
function poweroff(){
    cp.spawnSync('poweroff');
}

function restartplayer(){
    console.log('restarting ' + playerBackend);
    if (selectedPlayer) selectedPlayer.close();
    player = null;
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
    if (shuttingDown) return;
    if (songobj && songobj !== null){
        if (spotifyItem.isSong(songobj) && playerBackend !== 'lms') {
            io.sockets.emit('spotify-problem', {message:'Spotify playback requires the LMS backend'});
            return;
        }
        var currentPlayer = player;
        var currentPlaybackId = ++playbackId;
        try {
            if (playerBackend === 'lms' && !(await spotify.ownership.prepareForRandyPlayback(currentPlayer, () => !shuttingDown && player === currentPlayer && playbackId === currentPlaybackId, {deferConnectReset:!spotifyItem.isSong(songobj)}))) return;
            if (player !== currentPlayer || playbackId !== currentPlaybackId) return;
            console.log('Loading: ' + songobj.songfile);
            if (songobj.hasOwnProperty('songfile')){
                await currentPlayer.loadAndPlay(songobj, { playbackId: currentPlaybackId });
                if (player !== currentPlayer || playbackId !== currentPlaybackId) return;
                if (playerBackend === 'lms') {
                    if(!spotifyItem.isSong(songobj))spotify.ownership.afterRandyPlaybackStarted(
                        () => !shuttingDown && player === currentPlayer && playbackId === currentPlaybackId);
                    var status = await currentPlayer.getStatus();
                    if (player !== currentPlayer || playbackId !== currentPlaybackId) return;
                    emitLMSNowPlaying(status, songobj);
                }
                emitplaylist();
            }
        } catch(error) {
            if (player !== currentPlayer || playbackId !== currentPlaybackId) return;
            if (playerBackend === 'lms') {
                console.error('LMS playback failed - ' + error);
                io.sockets.emit('spotify-problem', {message:error.message});
                return;
            }
            console.log('Player is unresponsive, restarting mpv - error: ' + error);
            restartplayer();
        }
    } else {
        console.log('bad songobj + ' + JSON.stringify(songobj));
    }
}

async function getAllDevices() {
   var devices = [];

    try {
        const disks = await nodeDiskInfo.getDiskInfo();
        const platform = process.platform;

        disks.forEach((disk) => {
            if (!disk.mounted) return;

            let isUSB = false;
            const mountedPath = disk.mounted;
            const mountedLower = mountedPath.toLowerCase();
            const filesystem = (disk.filesystem || "").toLowerCase();

            // ==========================================
            // 1. MAC-SPECIFIC FILTERING (STRICT CLEANUP)
            // ==========================================
            if (platform === 'darwin') {
                // Ignore hidden firmware, VM space, preboots, recoveries and Docker/Nix mounts
                if (
                    mountedLower.startsWith('/system/volumes/') || 
                    mountedLower.startsWith('/private/') ||
                    mountedLower === '/dev' ||
                    mountedLower === '/nix' ||
                    filesystem.includes('devfs') ||
                    disk.blocks === 0
                ) {
                    return; // Skip background system clutter completely
                }

                // If it's in /Volumes, it's a real user-mounted drive (USB, external HDD)
                if (mountedLower.startsWith('/volumes/')) {
                    isUSB = true;
                }
                // If it's exactly "/", it's your primary Macintosh HD internal drive
            } 

            // ==========================================
            // 2. WINDOWS & LINUX CROSS-PLATFORM LOGIC
            // ==========================================
            else if (platform === 'win32') {
                if (filesystem.includes('removable')) {
                    isUSB = true;
                }
            } 
            else if (platform === 'linux') {
                // Ignore Linux loopbacks and system frames
                if (
                    mountedLower.startsWith('/run') ||
                    mountedLower.startsWith('/sys') ||
                    mountedLower.startsWith('/proc') ||
                    mountedLower.startsWith('/dev') ||
                    mountedLower.startsWith('/boot') ||
                    mountedLower === '/tmp' ||
                    filesystem.includes('tmpfs') ||
                    filesystem.includes('devtmpfs') ||
                    disk.blocks === 0
                ) {
                    return; // Skip system noise completely
                }

                if (mountedLower.startsWith('/media/') || mountedLower.startsWith('/mnt/')) {
                    isUSB = true;
                }
            }

            // ==========================================
            // 3. MAP THE CLEAN DRIVE OBJECT
            // ==========================================
            var device = {
                "name": platform === 'darwin' && mountedPath === '/' 
                        ? "Macintosh HD (Internal)" 
                        : `${disk.filesystem.toUpperCase()} (${mountedPath})`, 
                "size": disk.blocks, 
                "path": mountedPath, 
                "isUSB": isUSB
            };

            devices.push(device);
        });

    } catch (e) {
        console.error("Failed to read device disk information:", e);
    }

    return devices;
}
