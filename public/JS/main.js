// ==============================================
// Randy Player
// built by : Gideon Simons, 2018-2023
// ==============================================

var cursong = null;
var prevbrowserpanemode = null;
var curbrowserpanemode = null;
var scrolltosong = true;
var seekbarreleased = true;
var isplaying = false;
var ispausing = false;
var templist = {};
var musicfolderatinit = true;
var rot = 0;
var lastpos = -1;
var lastposupdate = -1;
var toasttimeout;
var showfullaudiodevicelist = false;

window.onload = function() {
    if (musicfolderatinit){
        browsepane("zen");
    }
    $('#browse-pane').css("visibility","visible");
    $('#browse-pane').addClass('mobilehideme');    
};

var rotateAnime = anime({
    targets: '.album-art',
    rotate:'1turn',
    duration:3500,
    easing:'linear',
    elasticity:0,
    loop: true,
    autoplay: false // prevent the instance from playing
  });

function debounce(func, wait, immediate) {
    var timeout;
    return function() {
        var context = this, args = arguments;
        var later = function() {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
};

var localSearchGeneration = 0;
$('#search-bar').on('input', function () { localSearchGeneration++; spotifyUI.invalidate(); });
$('#search-bar').keyup(debounce(async function(event) {
    var searchQuery = $('#search-bar').val(), searchGeneration = localSearchGeneration;
    spotifyUI.search(searchQuery);
    if (ValidURL($('#search-bar').val())){
        $('#browse-search-url').fadeOut();
        $('#search').addClass('loading');
        api.getURLMeta($('#search-bar').val()).then(function(meta){
           if (meta.title){
               templist.search = [$('#search-bar').val()];
               console.log(JSON.stringify(meta));
                var ht = "<div class='browse-search-x' onclick='$(\"#browse-search-url\").hide();'>" + randyUI.icon('close','Close') + "</div>";
                ht += "<div class='browse-search-img'>";
                ht += "<img src='" + meta.img + "'/>";
                ht += "</div>";
                ht += "<div class='browse-search-tit'>";
                ht += "<span class='tit'>" + meta.title + "</span>";
                ht += "</br>";
                ht += "<span class='desc'>" + meta.description + "</span>";
                ht += "</br>";
                ht += songoptions('search',0);
                ht += "</div>";
                $('#browse-search-url').html(ht); 
           } else {
               $('#browse-search-url').html("URL not found, try another url!"); 
           }
           $('#browse-search-url').fadeIn();
           $('#search').removeClass('loading');
        });
     } else {
         if ($('#search-bar').val().length < 2){
             browsepane("init");
         } else {
            $('#search').addClass('loading');
            browsepane('search-results');
             api.searchSongs(searchQuery).then(async function(rtn){
                if (searchGeneration !== localSearchGeneration) return;
                var res = rtn.results;     
                console.log("search results: " + JSON.stringify(res));
                 var ht = "";
                 var hasresults = false;
                 ht += "<button type='button' class='randy-action' onclick='browsepane(\"init\");' aria-label='Back to home' title='Back to home'>" + randyUI.icon('back') + "</button>";
                 //if no stations try from browser
                 if (res.radiostations.length == 0){
                    res.radiostations = await getRadios(searchQuery);
                    if (searchGeneration !== localSearchGeneration) return;
                 }
                 if (res.radiostations.length > 0){
                    hasresults = true;
                    templist.searchradiostations = [];
                    ht += "<h3>Radio Stations</h3>";
                    for (i in res.radiostations){
                        templist.searchradiostations.push(res.radiostations[i].path);
                        ht += "<div class='search-result'>";
                        ht += "<div class='search-result-name' onclick='doSongOption(\"playnow\",\"searchradiostations\",\""+i+"\")'>";
                        ht += "<span class='clickablelink'>" + res.radiostations[i].name + "</span>"; 
                        ht += "<span class='search-result-path'>" + res.radiostations[i].album + "</span>";
                        ht += "</div>"; 
                        ht += "<div class='search-result-options'>" + songoptions('searchradiostations',i) + "</div>";
                        ht += "</div>";
                    }
                }
                 if (res.albums.length > 0){
                    hasresults = true;
                     templist.searchalbums = [];
                     ht += "<h3>Local albums</h3>";
                     for (i in res.albums){
                         templist.searchalbums.push(res.albums[i].album);
                         ht += "<div class='local-album-slot' data-index='" + i + "'></div>";
                     }
                 }

                 if (res.files.length > 0){
                    hasresults = true;
                     templist.searchsongs = [];
                     ht += "<h3>Local songs</h3>";
                     for (i in res.files){
                        templist.searchsongs.push(res.files[i].path);
                        ht += "<div class='local-track-slot' data-index='" + i + "'></div>";
                     }
                 }
                 if (!hasresults){
                    ht += "<h3>No results...</h3>";
                 }
                
                $('#local-search-results').html(ht);
                ['album','track'].forEach(function(kind){
                    $('#local-search-results .local-'+kind+'-slot').each(function(){
                        var index=Number(this.dataset.index), item=(kind==='track'?res.files:res.albums)[index];
                        var list=kind==='track'?'searchsongs':'searchalbums';
                        var data={source:'local',title:item.title || item.name,artist:item.artist,album:item.albumName,artwork:item.albumart};
                        var actions={play:function(){doSongOption('playnow',list,index);},add:function(){doSongOption('addtolist',list,index);},sticky:function(){doSongOption('stick',list,index);}};
                        if(kind==='album')actions.open=function(){showAlbum(list,index);};
                        $(this).replaceWith(randyUI.row(data,actions));
                    });
                });
                $('#search').removeClass('loading');
                browsepane('search-results');
            });
         }
     }
    return true;
},500));

function get_radiobrowser_base_url_random() {
    return get_radiobrowser_base_urls().then(hosts => {
        var item = hosts[Math.floor(Math.random() * hosts.length)];
        return item;
    });
}

function get_radiobrowser_base_urls() {
    return new Promise((resolve, reject)=>{
        var request = new XMLHttpRequest()
        // If you need https, you have to use fixed servers, at best a list for this request
        request.open('GET', 'http://all.api.radio-browser.info/json/servers', true);
        request.onload = function() {
            if (request.status >= 200 && request.status < 300){
                var items = JSON.parse(request.responseText).map(x=>"https://" + x.name);
                resolve(items);
            }else{
                reject(request.statusText);
            }
        }
        request.send();
    });
}

async function getRadios(keyword){
    return new Promise(async function(resolve, reject) {
        var rurl = await get_radiobrowser_base_url_random();
        console.log("radio link " + rurl + '/json/stations/search/');
        fetch(rurl + "/json/stations/search?name=" + keyword + '&limit=8', {
            method: "GET",
            headers: {"Content-Type": "application/json; charset=utf-8"},
            //body: JSON.stringify({ name: keyword, limit: 8}),
        }).then((response) => response.json()).then((data) => {
            console.log("found " + data.length + " radios");
            var arr = [];
            for (var i in data){
                var radio = data[i];
                arr.push({ name:radio.name, 
                            album:radio.country + " - " + radio.language, 
                            path:{path:radio.url, site:radio.homepage, id:radio.stationuuid, name:radio.name, artist:radio.country + " - " + radio.language}});
            }
            console.log("radios: " + JSON.stringify(arr));
            resolve(arr);
        }).catch((error) => {
            console.error("getRadios error: " + error);
            resolve([]);
        });
    }); 
}

$('#top-text').on('click', function(){
   //api.randy(); 
   socket.emit('randy', '');
});

$('#top-icon-menu-mobile').on('click', function(){
    console.log("mobile menu press");
    browsepane("init");
    $('#browse-pane').toggleClass('mobilehideme');
    $('#playlist-pane').toggleClass('mobilehideme');
});

$('#top-icon-menu').on('click', function(){
    console.log("menu press");
    if (!$('#browse-zen').is(":visible")){
        browsepane("zen");
    } else {
        browsepane("init");
    }
});

$('.browse-top-back-icon').on('click', function(){
    //case for mobile
    $('#browse-pane').toggleClass('mobilehideme');
    $('#playlist-pane').toggleClass('mobilehideme');
});


$('#play').on('click', function(){
    //playing
    if (isplaying){
        isplaying = false;
        ispausing = true;
        console.log('emitting pause');
        socket.emit('pause', '');
        //$('#control-panel').removeClass('active');
    } else {
        ispausing = false;
        console.log('emitting play');
        socket.emit('play', '');
    }
});

$('.next').on('click', function(){
    socket.emit('next', 'hello');
});

$('.prev').on('click', function(){
    socket.emit('prev', 'hello');
});

function playsong(id){
    scrolltosong = false;
    socket.emit('playsong', id);
}

var socket = io();
socket.on('spotify-ownership', spotifyUI.setOwnership);

socket.on("disconnect", (reason) => {
    console.log("disconnected");
    showToast("randy server may be down",true);
});

socket.on("connect", (reason) => {
    console.log("connected");
    hideToast();
});

socket.on('nomusicfolder', function(obj){
    console.log("no music folder");
    musicfolderatinit = false;
    browsepane("settings");
});

socket.on('duration', function(obj){
    //console.log("got new duration: " + obj);
    cursong.find('.onesong-len').attr("len",obj);
});

socket.on('volume', function(obj){
    document.getElementById("volume-slider").value = obj;
});

socket.on('newstickies', function(obj){
    populateStickies($('.browse-init-sticky'), 5);
});

socket.on('audiostats', function(obj){
    cursong.find('.onesong-info').html(obj);
});

socket.on('problem', function(obj){
    showToast('Problem playing songs! Check your music source or sound output');
});

function rotateit(curpos){
    setTimeout(function(){ 
        var diff = Math.abs(curpos - lastpos);
        //console.log("curpos - " + curpos + " , lastpos - " + lastpos + " , diff - " + diff);
        isplaying = (diff < 2 && diff != 0);
        if (isplaying){
            if (rotateAnime.paused){
                //console.log("ani start");
                rotateAnime.play();
            }
        } else {
            //console.log("ani stop");
            rotateAnime.pause();
        }
    }, 500);
}

socket.on('pos', function(obj){
    rotateit(obj);
    lastpos = obj;
    var lenel = cursong.find('.onesong-len');
    var tlen = parseInt(lenel.attr("len"));
    var tot = "</span>";
    if (!isNaN(tlen)){
        tot = "/</span><span class='pos-sec-tot'>" + secondsToHms(tlen) + "</span>";
    }
    lenel.html("<span class='pos-sec'>" + secondsToHms(obj) + tot);
    if (seekbarreleased){
        var perc = Math.round((Math.round(obj) / Math.round(tlen))*100);
        //console.log("perc " - perc);
        $('#dial').val(perc).trigger('change');
    }
});

socket.on('nowplaying', function(obj){
    spotifyUI.updateNowPlaying(obj);
    console.log("now playing: " + obj.title + ", album art - " + JSON.stringify(obj.albumart));
    //console.log("album: " + obj.album);
    document.title = obj.title;
    var al = (obj.source === 'spotify' || obj.source === 'spotify_connect') ? randyUI.coverUrl(obj.albumart,640) : encodeURI(obj.albumart);
    var sign = "";
    if (!ValidAAURL(al)){
        al = 'https://api.dicebear.com/9.x/notionists/svg?seed='+obj.album;
        sign = '<span>No Album Cover...?<br/>Randy got you covered! (<a href="https://www.dicebear.com/" target="_blank">https://www.dicebear.com/</a>)</span>';
    }
    if (cursong != null){
        var titleText=cursong.find('.randy-title-text');
        if(titleText.length)titleText.text(obj.title);
        else cursong.find(".onesong-tit")[(obj.source === 'spotify' || obj.source === 'spotify_connect') ? 'text' : 'html'](obj.title);
        cursong.find('.onesong-tit').attr('title',obj.title);
        if ((obj.source === 'spotify' || obj.source === 'spotify_connect')) cursong.find('.spotify-cover').attr('src', al);
        if (obj.hasOwnProperty('album')){
            cursong.find(".onesong-artist")[(obj.source === 'spotify' || obj.source === 'spotify_connect') ? 'text' : 'html'](obj.album);
        }
        var newimg = "<img class='album-cover-pane' src=\"" + spotifyUI.escape(al) + "\"/>" + sign;
        if ($('#browse-zen').find("img").attr("src") != al){
            if ($('#browse-zen').is(":hidden")){
                $('.album-art').css("background-image", 
                                    'url("' + (ValidAAURL(al) ? al : 'IMG/Record.png') + '")');
                $('#browse-zen').html(newimg);
            } else {
                $('#browse-zen').hide().html(newimg).fadeIn(400);
            }
        }
    }
});

socket.on('playlist', function(objj){
   var plist = $('#songlist');
   var obj = objj.playlist;
   //clear
   plist.html('');
   var curid = 0;
   for (var i=0; i<obj.length; i++){
       var plitemclass = "onesong-prevs";
       if (objj.playing == i){
           plitemclass = "onesong-current";
           curid = i;
       } else if (objj.playing < i){
           plitemclass = "onesong-nexts";
       }
       //meta
       var len = "";
       var tit = "";
       var artistalbum = "";
       if (obj[i].hasOwnProperty('tags')){
            tit = obj[i].tags.common.title;
            artistalbum = obj[i].tags.common.artist;
            if (obj[i].type == "file" || obj[i].type === "spotify"){
                len = obj[i].type === 'spotify' && !obj[i].tags.format.duration ? '' : Math.round(obj[i].tags.format.duration);
                artistalbum = obj[i].tags.common.album + " - " + obj[i].tags.common.artist;
            } 
        }
       var ns = "<div onclick='playsong("+i+");' class='onesong " + plitemclass + "' id='song_" + i + "' data-id='" + i + "'>";
       if (obj[i].type === 'spotify' || obj[i].type === 'file') {
           tit = randyUI.escape(tit); artistalbum = randyUI.escape(artistalbum);
       }
       ns += "<div class='onesong-details'>";
       ns += "<div class='onesong-tit' title='" + tit + "'>" + ((obj[i].type==='spotify'||obj[i].type==='file') ? randyUI.sourceIcon(obj[i].type)+'<span class="randy-title-text">'+tit+'</span>' : tit) + "</div>";
       ns += "<div class='onesong-artist' title='" + artistalbum + "'>" + artistalbum + "</div>";
       if (objj.playing == i){
        ns += "<div class='onesong-info'>  -  </div>";
       }
       ns += "</div>";
       ns += "<div class='onesong-len' len='" + len + "'>" + secondsToHms(len) + "</div>";
       ns += "</div>";
       plist.append(ns);
   } 
    //set the current song
    cursong = $('#song_' + curid);
    spotifyUI.useConnectRow(curid);
    //scroll to the current song
    if (scrolltosong){
        var firstel = $('#song_1');
        var hei = firstel.outerHeight()*(curid-3);
        $('#playlist-pane-songlist').scrollTop(hei);
    }
    scrolltosong = true;
});

function browsepane(mode){
    prevbrowserpanemode = curbrowserpanemode;
    curbrowserpanemode = mode;
    console.log("change mode to: " + mode);
    $('#browse-modes').children().hide();
    $('#browse-' + mode).fadeIn();
    $('#browse-search-url').hide();
    if (mode != "zen"){
        $('#browse-home').show();
        $('#browse-zen').hide();
        //sync the images
        var curimg = $('#browse-zen').find("img").attr("src");
        $('.album-art').css("background-image", 'url("' + ((ValidURL(curimg) || (curimg || '').indexOf('/spotify/artwork?') === 0) ? curimg : 'IMG/Record.png') + '")');
    } else {
        $('#browse-home').hide();
        $('#browse-zen').show();
        $('.album-art').css("background-image", 'url("IMG/Record.png")');
    }
    switch(mode) {
        case "zen":
            
            break;
        case "stickies":
            api.getStickyList().then(function(rtn){
                var res = rtn.results;     
                var ht = "";
                ht += "<button type='button' class='randy-action' onclick='browsepane(\"init\");' aria-label='Back to home' title='Back to home'>" + randyUI.icon('back') + "</button>";
                 if (res.length > 0){
                     templist.allstickies = [];
                     ht += "<h3>Sticky</h3>";
                     for (i in res){
                         templist.allstickies.push(res[i].path);
                         ht += "<div class='search-result'>";
                         ht += "<div class='search-result-name clickablelink' onclick='doSongOption(\"playnow\",\"allstickies\",\""+i+"\")'>" + (res[i].source === 'spotify' ? '<img class="spotify-cover" alt="Spotify" src="' + spotifyUI.escape(res[i].albumart) + '">' + spotifyUI.escape(res[i].name) : res[i].name) + "</div>";
                         ht += "<div class='search-result-options'>" + songoptions('allstickies',i) + "</div>";
                         ht += "</div>";
                     }
                 }
                $('#browse-stickies').html(ht); 
            });
            break;
        case "files":
            api.getAlbums().then(function(rtn){
                var res = rtn.results;     
                var ht = "";
                ht += "<button type='button' class='randy-action' onclick='browsepane(\"init\");' aria-label='Back to home' title='Back to home'>" + randyUI.icon('back') + "</button>";
                 if (res.albums.length > 0){
                     templist.allalbums = [];
                     //ht += "<h3>Local albums</h3>";
                     var lastalb = "";
                     for (i in res.albums){
                         var albarr = res.albums[i].albumpath.split("/");
                         var curalb = albarr[(albarr.length - 1)];
                         if (curalb != lastalb){
                            ht += "<h3>" + curalb + "</h3>";
                         }
                         lastalb = curalb;
                         templist.allalbums.push(res.albums[i].album);
                         ht += "<div class='search-result'>";
                         ht += "<div class='search-result-name' onclick='showAlbum(\"allalbums\",\""+i+"\")'>";
                         ht += "<span class='clickablelink'>" + res.albums[i].name + "</span>"; 
                         //ht += "<span class='search-result-path'>" + res.albums[i].albumpath + "</span>";
                         ht += "</div>"; 
                         ht += "<div class='search-result-options'>" + songoptions('allalbums',i) + "</div>";
                         ht += "</div>";
                     }
                 }
                $('#browse-files').html(ht); 
            });
            break;
        case "album":
            var albumPath = templist.curalbum;
            var albumBack = prevbrowserpanemode;
            $('#browse-album').empty().text('Loading album…');
            api.getAlbum(albumPath).then(function(rtn){
                if (curbrowserpanemode !== 'album' || templist.curalbum !== albumPath) return;
                var res = rtn.results;
                var pane = $('#browse-album').empty();
                pane.append($('<button type="button">').text(albumBack === 'search-results' ? 'Back to search' : 'Back to albums').on('click',function(){browsepane(albumBack);}));
                pane.append(randyUI.cover(res.albumart).addClass('album-detail-cover'),$('<h3>').text(res.name),
                    $('<p>').text([res.artist,res.year].filter(Boolean).join(' · ')));
                templist.curalbumfiles = res.files.map(function(file){return file.path;});
                function albumAction(action){socket.emit(action,albumPath);if(action==='addtolist')showToast('Adding to the end of the playlist');}
                if(res.files.length) {
                    pane.append($('<button type="button">').text('Play album').on('click',function(){albumAction('playnow');}),
                        $('<button type="button">').text('Add album').on('click',function(){albumAction('addtolist');}));
                }
                res.files.forEach(function(file,index){
                    pane.append(randyUI.row({source:'local',title:file.title || file.name,artist:file.artist,album:file.albumName,artwork:file.albumart},{
                        play:function(){doSongOption('playnow','curalbumfiles',index);},
                        add:function(){doSongOption('addtolist','curalbumfiles',index);},
                        sticky:function(){doSongOption('stick','curalbumfiles',index);}
                    }));
                });
            });
            break;
        case "init":
            //populate stickies
            populateStickies($('.browse-init-sticky'), 5);
            //populate random albums
            api.getRandomAlbums(8).then(function(rtn){
                var res = rtn.results;     
                var ht = "";
                 if (res.albums.length > 0){
                     templist.initralbums = [];
                     ht += "<h3>Random Albums</h3>";
                     ht += "<div class='random-albums'>";
                     for (i in res.albums){
                         templist.initralbums.push(res.albums[i].album);
                         ht += "<img alt=\"" + res.albums[i].name + "\" title=\"" + res.albums[i].name + "\" src=\"" + encodeURI(res.albums[i].albumArt) + "\"  onerror=\"this.onerror=null;fixBroken(this,'initralbums','"+i+"','"+res.albums[i].name+"');\" onclick='doSongOption(\"playnow\",\"initralbums\",\""+i+"\")'/>";
                     }
                     ht += "</div>";
                 }
                $('.browse-init-randomalbums').html(ht); 
            });
        break;
        case "settings":
            $('#devices').html('');
            $('#loadingdevices').addClass('loading');
            api.getSettings().then(function(rtn){
                $('#loadingdevices').removeClass('loading');
                var res = rtn;     
                var ht = "";
                templist.connectedDevices = [];
                templist.audiodDevices = [];
                var founddev = false;
                //storage devices
                if (res.devices.length > 0){
                     for (i in res.devices){
                        templist.connectedDevices.push(res.devices[i].path);
                        ht += "<div class='device'><div class='device-main'>" + res.devices[i].name + "<br/>" + formatBytes(res.devices[i].size,2) + "</div>";
                        if (res.devices[i].path == res.cursettings.musicfolders){
                           founddev = true;
                           ht += "<div class='setit' onclick='changemfd("+i+");'>" + randyUI.icon('check','Selected') + "</div><div class='spinner'>" + randyUI.icon('spinner') + "</div>";
                        } else {
                           ht += "<div class='setit' onclick='changemfd("+i+");'>Set</div><div class='spinner'>" + randyUI.icon('spinner') + "</div>";
                        }
                        ht += "</div>";
                     }
                 }
                 ht += "<div class='device'><div class='device-main'>Custom path (folder, NAS..)<br/>";
                 ht += "<input class='settings-inp' onkeyup='$(\".setit\").html(\"Set\");' type='text' id='mf_inp' placeholder='Path to music folder'";
                 console.log('templist.connectedDevices - ' + templist.connectedDevices);
                 if (!founddev && res.cursettings.musicfolders !== null){
                    ht += " value='" + res.cursettings.musicfolders[0] + "'/></div>";
                    ht += "<div class='setit' onclick='changemf();'>" + randyUI.icon('check','Selected') + "</div><div class='spinner'>" + randyUI.icon('spinner') + "</div>";
                 } else {
                    ht += "/></div>";
                    ht += "<div class='setit' onclick='changemf();'>Set</div><div class='spinner'>" + randyUI.icon('spinner') + "</div>";
                 }
                 ht += "</div>";
                 //audio devices
                 console.log(res.audiodevices.length);
                 if (res.audiodevices.length > 0){
                    ht += "<h3>AUDIO DEVICES</h3>";
                    //if not advanced view remove some things
                    var audiodevices = res.audiodevices;
                    var selectedaudiodevices = [];
                    res.audiodevices.forEach((device) => {
                        if (device.name.includes(':')){
                            if (device.name.includes('hw') || device.name.includes('plughw')){
                                selectedaudiodevices.push(device);
                            }
                        } else {
                            if ((device.name.includes('/') && !device.name.includes('default')) || device.name == "auto"){
                                selectedaudiodevices.push(device);
                            }
                        }
                    });
                    if (!showfullaudiodevicelist){
                        audiodevices = selectedaudiodevices;
                    }
                    var cards = [];
                    var cardsobj = [];
                    //populate into cards
                    audiodevices.forEach((device) => {
                        if (device.name.includes(':')){
                            var card = device.description.split('/').splice(0,1).join("/"); //CARD=vc4hdmi, DEV=2
                            if (!cards.includes(card)){
                                cards.push(card);
                                cardsobj.push({"card":card, "name":card, "plugins":[device]});
                            } else {
                                var cardobj = cardsobj.find(e => e.card == card);
                                cardobj.plugins.push(device);
                            }
                        } else {
                            cardsobj.push({"card":device.name, "name":device.description, "plugins":[device]});
                        }
                    });
                    var ind = 0;
                    cardsobj.forEach((card) => {
                        var setit = 'Set';
                        if (card.plugins.find(e => e.name == res.cursettings.audioOutputDevice)){
                            setit = "" + randyUI.icon('check','Selected') + "";
                        }
                        var whichvar = card.card;
                        var selectplugin = "";
                        if (card.plugins.length > 1){
                            selectplugin = '<select id="cardselect' + ind + '">';
                            card.plugins.forEach((plugin) => {
                                selectplugin += '<option value="' + plugin.name + '"';
                                if (res.cursettings.audioOutputDevice == plugin.name){
                                    selectplugin += " selected";
                                }
                                selectplugin += '>' + plugin.description.split('/').splice(1).join("/") + " [" + plugin.name.split(":")[0] + ']</option>';
                            });
                            selectplugin += "</select>";
                            whichvar = "selectelement_" + "#cardselect"+ind;
                        } 
                        ht += "<div class='device'><div class='device-main'>" + card.name + "</div>";
                        ht += "<div class='device-select'>" + selectplugin + "</div>";
                        ht += "<div class='setit' onclick='setSetting(\"audioOutputDevice\", \"" + whichvar + "\",\"Setting audio device\");'>";
                        ht += setit + "</div>";
                        ht += "<div class='spinner'>" + randyUI.icon('spinner') + "</div>";
                        ht += "</div>";
                        ind++;
                    });
                    if (res.audiodevices.length > selectedaudiodevices.length){
                        if (showfullaudiodevicelist){
                            ht += "<div id='toggleshowalldevices' onclick='toggleaudiodeviceview()'>show less</div>";
                        } else {
                            ht += "<div id='toggleshowalldevices' onclick='toggleaudiodeviceview()'>show all options (advanced)</div>";
                        }
                    }
                 }
                $('#devices').html(ht); 
                var playonstart = res.cursettings.playonstart;
                if (playonstart == "true" || playonstart == null){
                    $('#playonstart').prop("checked", true);
                } else {
                    $('#playonstart').prop("checked", false);
                }
                $('#playonstartform :checkbox').change(function () {
                    console.log("playonstartform changed");
                    if ($(this).is(':checked')) {
                        setSetting("playonstart",true, "setting saved");
                    } else {
                        setSetting("playonstart",false, "setting saved");
                    }
                });
            });
            console.log('in settings');
        break;
    }
}

function populateStickies(ele, lim){
    console.log('populating stickies');
    api.getStickyList(lim).then(function(rtn){
        var res = rtn.results;     
        var ht = "";
         if (res.length > 0){
             templist.initstickies = [];
             if (res.length >= lim){
                ht += "<span class='h3'>Sticky</span><span class='h3 seeall' onclick='browsepane(\"stickies\")'>See All</span>";
             } else {
                ht += "<h3>Sticky</h3>";
             }
             for (i in res){
                 templist.initstickies.push(res[i].path);
                 ht += "<div class='search-result'>";
                 ht += "<div class='search-result-name clickablelink' onclick='doSongOption(\"playnow\",\"initstickies\",\""+i+"\")'>" + (res[i].source === 'spotify' ? '<img class="spotify-cover" alt="Spotify" src="' + spotifyUI.escape(res[i].albumart) + '">' + spotifyUI.escape(res[i].name) : res[i].name) + "</div>";
                 ht += "<div class='search-result-options'>" + songoptions('initstickies',i) + "</div>";
                 ht += "</div>";
             }
         }
        ele.html(ht); 
    });
}

//volume//
function changeVolume(val){
    console.log('vol ' + val);
    socket.emit('volume', val);
}

//knob//
$("#dial").knob({
    'min':0,
    'max':100,
    'angleArc':180,
    'angleOffset':270,
    'width':270,
    'height':270,
    'displayInput':false,
    'release' : function (v) { 
        if (!seekbarreleased){
            var lenel = cursong.find('.onesong-len');
            var tlen = Number(lenel.attr("len"));
            if (Number.isFinite(tlen) && tlen > 0 && Number.isFinite(Number(v))) {
                // Keep a drag to the end inside the track; do not accidentally
                // trigger SpotOn/LMS's next-track path by seeking past EOF.
                socket.emit('seek', Math.min(tlen - 0.01, Math.max(0, Math.round(v/100*tlen))));
            }
            seekbarreleased = true;
            console.log('knob at ' + v);
        }
    }
});

$("#seekdial").bind("mousedown touchstart" ,function() {
    seekbarreleased = false;
});

function changemf(){
    var mf = $('#mf_inp').val();
    if (mf !== ''){
        $('.device').addClass('loading');
        api.setMusicFolder([$('#mf_inp').val()]).then(function(ret){
            $('.device').removeClass('loading');
            browsepane('settings');
            if (ret.success !== 200){
                showToast('Something went wrong');
            } else {
                showToast('New Music Source Set!');
            }
        });;
    } else {
        showToast('Enter a music source');
    }
}

function changemfd(i){
    $('.device').addClass('loading');
    api.setMusicFolder([templist.connectedDevices[i]]).then(function(ret){
        $('.device').removeClass('loading');
        browsepane('settings');
        if (ret.success !== 200){
            showToast('Something went wrong');
        } else {
            showToast('New Music Source Set!');
        }
    });
}

function toggleaudiodeviceview(){
    showfullaudiodevicelist = !showfullaudiodevicelist;
    browsepane('settings');
}

function setSetting(obj,key,msg){
    if (key.includes('selectelement_')){
        var ele = key.replace('selectelement_','');
        console.log("ele " + ele);
        console.log("selected " + $("#cardselect4").find(':selected').val());
        key = $(ele).find(':selected').val();
    }
    console.log("setting " + obj + " with " + key);
    api.setSetting(obj,key).then(function(ret){
        browsepane('settings');
        if (ret.success !== 200){
            showToast('Something went wrong');
        } else {
            showToast(msg);
        }
    });
}

function poweroff(){
    api.powerOff();
}

function showToast(txt,isconsistant){
    console.log("showtoast " + txt);
    clearTimeout(toasttimeout);
    $("#snackbar").html(txt);
    var x = document.getElementById("snackbar");
    if (!isconsistant){
        x.className = "show";
        toasttimeout = setTimeout(function(){ x.className = ""; }, 3000);
    } else {
        x.className = "showconsistant";
    }
}

function hideToast(){
    clearTimeout(toasttimeout);
    var x = document.getElementById("snackbar");
    x.className = "";
}

//album view//
function showAlbum(list,i){
    templist.curalbum = templist[list][i];
    templist.curalbumi = i;
    browsepane('album');
}

//fix broken images
function fixBroken(ele,list,i,name){
    console.log('fixing image - ' + templist[list][i]);
    //templist[list][i];
    $(ele).replaceWith("<div class='placeholder'><span>"+name+"</span></div>");
    $(ele).height = $(ele).width;
}

//song options//
function songoptions(obj,i){
    var actions=[];
    if(obj.indexOf('album')!==-1||obj.indexOf('search')!==-1)actions.push(['play','Play','playnow']);
    actions.push(['add','Add to queue','addtolist']);
    actions.push(obj.indexOf('stickies')===-1?['sticky','Sticky','stick']:['remove','Remove','unstick']);
    return '<div class="song-options randy-item-actions">'+actions.map(function(action){
        return '<button type="button" class="randy-action" title="'+action[1]+'" aria-label="'+action[1]+'" onclick="doSongOption(\''+action[2]+'\',\''+obj+'\',\''+i+'\')">'+randyUI.icon(action[0])+'</button>';
    }).join('')+'</div>';
}

function doSongOption(op,opt,i){
    console.log("emitting - " + op + " , urls: " + templist[opt][i]);
    socket.emit(op,templist[opt][i]);
    //on mobile go back to playlist
    if (op == "playnow"){
        $('#browse-pane').toggleClass('mobilehideme');
        $('#playlist-pane').toggleClass('mobilehideme');
    } else if (op == "addtolist"){
        showToast('Adding to the end of the playlist');
    } else if (op == "stick"){
        Bounce($('#homebutt'));
        showToast('Adding to sticky bookmarks');
    } else if (op == "unstick"){
        showToast('Removing from sticky bookmarks');
        browsepane(curbrowserpanemode);
    }
}

////utils////
function secondsToHms(t) {
    if (isNaN(t)){
        return "";
    }
    var time = Math.round(t);
    var hr = ~~(time / 3600);
    var min = ~~((time % 3600) / 60);
    var sec = time % 60;
    var sec_min = "";
    if (hr > 0) {
       sec_min += "" + hr + ":" + (min < 10 ? "0" : "");
    }
    sec_min += "" + min + ":" + (sec < 10 ? "0" : "");
    sec_min += "" + sec;
    return sec_min;
 }

function ValidURL(str) {
  regexp =  /^(?:(?:https?|ftp):\/\/)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:\/\S*)?$/;
  return regexp.test(str);
}

function formatBytes(a,b=2,k=1024) {
    with(Math){let d=floor(log(a)/log(k));
    return 0==a?"0 Bytes":parseFloat((a/pow(k,d)).toFixed(max(0,b)))+" "+["Bytes","KB","MB","GB","TB","PB","EB","ZB","YB"][d]}
}


function ValidAAURL(str){
    return (ValidURL(str) || str.indexOf('/spotify/artwork?') === 0 || str === '/IMG/Record.png' || str.indexOf("/mnt/") == 0);
}

function Bounce(ele) {
    ele.removeClass('bounce').delay(50).queue(
        function (next) {
            $(this).addClass('bounce');
            next();
        }
    );
}

$('[data-randy-icon][role=button]').on('keydown', function(event) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $(this).trigger('click'); }
});
