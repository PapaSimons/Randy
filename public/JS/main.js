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

$('#search-bar').keyup(function(event) {
    if (ValidURL($('#search-bar').val())){
        api.getURLMeta($('#search-bar').val()).then(function(meta){
           if (meta.title){
               templist.search = [$('#search-bar').val()];
               console.log(JSON.stringify(meta));
                var ht = "<div class='browse-search-x' onclick='$(\"#browse-search-url\").hide();'>X</div>";
                ht += "<div class='browse-search-img'>";
                ht += "<img src='" + meta.img + "'/>";
                ht += "</div>";
                ht += "<div class='browse-search-tit'>";
                ht += meta.title;
                ht += "</br></br>";
                ht += "<span class='desc'>" + meta.description + "</span>";
                ht += "</br>";
                ht += songoptions('search',0);
                ht += "</div>";
                $('#browse-search-url').html(ht); 
           } else {
               $('#browse-search-url').html("Not found, try another url!"); 
           }
           $('#browse-search-url').fadeIn();
        });
     } else {
         if ($('#search-bar').val().length < 2){
             browsepane("init");
         } else {
             api.searchSongs($('#search-bar').val()).then(function(rtn){
                var res = rtn.results;     
                console.log("search results: " + JSON.stringify(res));
                 var ht = "";
                 ht += "<img class='clickable' onclick='browsepane(\"init\");' src='IMG/back_icon.png'/>";
                 if (res.radiostations.length > 0){
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
                     templist.searchalbums = [];
                     ht += "<h3>Albums</h3>";
                     for (i in res.albums){
                         templist.searchalbums.push(res.albums[i].album);
                         ht += "<div class='search-result'>";
                         ht += "<div class='search-result-name' onclick='showAlbum(\"searchalbums\",\""+i+"\")'>";
                         ht += "<span class='clickablelink'>" + res.albums[i].name + "</span>"; 
                         ht += "<span class='search-result-path'>" + res.albums[i].albumpath + "</span>";
                         ht += "</div>"; 
                         ht += "<div class='search-result-options'>" + songoptions('searchalbums',i) + "</div>";
                         ht += "</div>";
                     }
                 }

                 if (res.files.length > 0){
                     templist.searchsongs = [];
                     ht += "<h3>Songs</h3>";
                     for (i in res.files){
                        templist.searchsongs.push(res.files[i].path);
                        ht += "<div class='search-result'>";
                        ht += "<div class='search-result-name clickablelink' onclick='doSongOption(\"playnow\",\"searchsongs\",\""+i+"\")'>" + res.files[i].name + "</div>"; 
                        ht += "<div class='search-result-options'>" + songoptions('searchsongs',i) + "</div>";
                        ht += "</div>";
                     }
                 }
                $('#browse-search-results').html(ht); 
                browsepane('search-results');
            });
         }
     }
    return true;
});

$('#top-text').on('click', function(){
   //api.randy(); 
   socket.emit('randy', '');
});

$('#top-icon-menu-mobile').on('click', function(){
    console.log("mobile menu press");
    browsepane("init");
    $('#browse-pane').toggleClass('mobilehideme');
    $('#playlist-pane').toggleClass('mobilehideme');
    $('.browse-top-back-icon').toggleClass('mobilehideme');
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
    $('.browse-top-back-icon').toggleClass('mobilehideme');
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

socket.on('nomusicfolder', function(obj){
    console.log("no music folder");
    musicfolderatinit = false;
    browsepane("settings");
});

socket.on('duration', function(obj){
    //console.log("got new duration: " + obj);
    cursong.find('.onesong-len').attr("len",obj);
});

function rotateit(curpos){
    setTimeout(function(){ 
        var diff = Math.abs(curpos - lastpos);
        //console.log("curpos - " + curpos + " , lastpos - " + lastpos + " , diff - " + diff);
        isplaying = (diff < 2 && diff != 0);
        if (isplaying){
            if (rotateAnime.paused){
                console.log("ani start");
                rotateAnime.play();
            }
        } else {
            console.log("ani stop");
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
    console.log("now playing: " + obj.title + " album art - " + JSON.stringify(obj.albumart));
    document.title = obj.title;
    var al = encodeURI(obj.albumart);
    if (!ValidAAURL(al)){
        al = 'IMG/Elephant_Walking_animated.gif';
    }
    if (cursong != null){
        cursong.find(".onesong-tit").html(obj.title);
        if (obj.hasOwnProperty('album')){
            cursong.find(".onesong-artist").html(al);
        }
        var newimg = "<img class='album-cover-pane' src=\"" + al + "\"/>";
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
            if (obj[i].type == "file"){
                len = Math.round(obj[i].tags.format.duration);
                artistalbum = obj[i].tags.common.album + " - " + obj[i].tags.common.artist;
            } 
        }
       var ns = "<div onclick='playsong("+i+");' class='onesong " + plitemclass + "' id='song_" + i + "' data-id='" + i + "'>";
       ns += "<div class='onesong-details'>";
       ns += "<div class='onesong-tit' title='" + tit + "'>" + tit + "</div>";
       ns += "<div class='onesong-artist' title='" + artistalbum + "'>" + artistalbum + "</div>";
       ns += "</div>";
       ns += "<div class='onesong-len' len='" + len + "'>" + secondsToHms(len) + "</div>";
       ns += "</div>";
       plist.append(ns);
   } 
    //set the current song
    cursong = $('#song_' + curid);
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
        $('.album-art').css("background-image", 'url("' + (ValidURL(curimg) ? curimg : 'IMG/Record.png') + '")');
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
                ht += "<img class='clickable' onclick='browsepane(\"init\");' src='IMG/back_icon.png'/>";
                 if (res.length > 0){
                     templist.allstickies = [];
                     ht += "<h3>Sticky</h3>";
                     for (i in res){
                         templist.allstickies.push(res[i].path);
                         ht += "<div class='search-result'>";
                         ht += "<div class='search-result-name clickablelink' onclick='doSongOption(\"playnow\",\"allstickies\",\""+i+"\")'>" + res[i].name + "</div>"; 
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
                ht += "<img class='clickable' onclick='browsepane(\"init\");' src='IMG/back_icon.png'/>";
                 if (res.albums.length > 0){
                     templist.allalbums = [];
                     ht += "<h3>Albums</h3>";
                     for (i in res.albums){
                         templist.allalbums.push(res.albums[i].album);
                         ht += "<div class='search-result'>";
                         ht += "<div class='search-result-name' onclick='showAlbum(\"allalbums\",\""+i+"\")'>";
                         ht += "<span class='clickablelink'>" + res.albums[i].name + "</span>"; 
                         ht += "<span class='search-result-path'>" + res.albums[i].albumpath + "</span>";
                         ht += "</div>"; 
                         ht += "<div class='search-result-options'>" + songoptions('allalbums',i) + "</div>";
                         ht += "</div>";
                     }
                 }
                $('#browse-files').html(ht); 
            });
            break;
        case "album":
            api.getAlbum(templist.curalbum).then(function(rtn){
                var res = rtn.results;     
                var ht = "";
                ht += "<img class='clickable' onclick='browsepane(\""+prevbrowserpanemode+"\");' src='IMG/back_icon.png'/>";
                 if (res.files.length > 0){
                     templist.curalbumfiles = [];
                     ht += "<h3>" + res.name + "</h3>";
                     for (i in res.files){
                        templist.curalbumfiles.push(res.files[i].path);
                        ht += "<div class='search-result'>";
                        ht += "<div class='search-result-name clickablelink' onclick='doSongOption(\"playnow\",\"curalbumfiles\",\""+i+"\")'>" + res.files[i].name + "</div>"; 
                        ht += "<div class='search-result-options'>" + songoptions('curalbumfiles',i) + "</div>";
                        ht += "</div>";
                         
                     }
                 }
                $('#browse-album').html(ht); 
            });
            break;
        case "init":
            api.getStickyList(5).then(function(rtn){
                var res = rtn.results;     
                var ht = "";
                 if (res.length > 0){
                     templist.initstickies = [];
                     ht += "<h3>Sticky</h3>";
                     for (i in res){
                         templist.initstickies.push(res[i].path);
                         ht += "<div class='search-result'>";
                         ht += "<div class='search-result-name clickablelink' onclick='doSongOption(\"playnow\",\"initstickies\",\""+i+"\")'>" + res[i].name + "</div>"; 
                         ht += "<div class='search-result-options'>" + songoptions('initstickies',i) + "</div>";
                         ht += "</div>";
                     }
                 }
                $('.browse-init-sticky').html(ht); 
            });
            api.getRandomAlbums(8).then(function(rtn){
                var res = rtn.results;     
                var ht = "";
                 if (res.albums.length > 0){
                     templist.initralbums = [];
                     ht += "<h3>Albums</h3>";
                     for (i in res.albums){
                         templist.initralbums.push(res.albums[i].album);
                         ht += "<img src=\"" + encodeURI(res.albums[i].albumArt) + "\" onclick='doSongOption(\"playnow\",\"initralbums\",\""+i+"\")'/>";
                     }
                 }
                $('.browse-init-randomalbums').html(ht); 
            });
        break;
        case "settings":
            console.log('in settings');
        break;
    }
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
            var tlen = parseInt(lenel.attr("len"));
            socket.emit('seek', Math.round(v/100*tlen));
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
    $("#mf_err").html("");
    if (mf !== ''){
        $("#mf_but").addClass("running");
        api.setMusicFolder([$('#mf_inp').val()]).then(function(ret){
            $("#mf_but").removeClass("running");
            if (ret.success !== 200){
                $("#mf_err").html("Try another folder");
            }
        });;
    }
}

//album view//
function showAlbum(list,i){
    templist.curalbum = templist[list][i];
    browsepane('album');
}

//song options//
function songoptions(obj,i){
    var ht = "<div class='song-options'>";
    if (obj.indexOf("album") != -1 || obj.indexOf("search") != -1){
        ht += "<img class='clickable' onclick='doSongOption(\"playnow\",\""+obj+"\",\""+i+"\")' src='IMG/icon_playnow.png'/>";
    }
    ht += "<img class='clickable' onclick='doSongOption(\"addtolist\",\""+obj+"\",\""+i+"\")' src='IMG/icon_plus.png'/>";
    if (obj.indexOf("stickies") == -1){
        ht += "<img class='clickable' onclick='doSongOption(\"stick\",\""+obj+"\",\""+i+"\")' src='IMG/icon_love.png'/>";
    }
    ht += "</div>";
    return ht;
}

function doSongOption(op,opt,i){
    console.log("emitting - " + op + " , urls: " + templist[opt][i]);
    socket.emit(op,templist[opt][i]);
    //on mobile go back to playlist
    if (op != "stick"){
        $('#browse-pane').toggleClass('mobilehideme');
        $('#playlist-pane').toggleClass('mobilehideme');
    } else {
        Bounce($('#stickybutt'));
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
       sec_min += "" + hrs + ":" + (min < 10 ? "0" : "");
    }
    sec_min += "" + min + ":" + (sec < 10 ? "0" : "");
    sec_min += "" + sec;
    return sec_min;
 }

function ValidURL(str) {
  regexp =  /^(?:(?:https?|ftp):\/\/)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:\/\S*)?$/;
  return regexp.test(str);
}

function ValidAAURL(str){
    return (ValidURL(str) || str.indexOf("/mnt/") == 0);
}

function Bounce(ele) {
    ele.removeClass('bounce').delay(50).queue(
        function (next) {
            $(this).addClass('bounce');
            next();
        }
    );
}