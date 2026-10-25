/* Spotify browsing uses LMS/SpotOn only. No Spotify credentials enter Randy. */
var spotifyUI = (function () {
    'use strict';
    var ownership = 'randy', queueIndex = 0, lastWasConnect = false, connectMetadata = null, connectTrack = null, connectStopped = false;
    var chimeContext, connectAnnounced=false;
    var spotifyBrowseHistory = [];
    var connectTarget, lastToast, state, generation = 0, searchTimer, controller, browseGeneration = 0;
    var labels = { connected: 'Connected', 'not-connected': 'Not connected', connecting: 'Connecting',
        'not-installed': 'SpotOn not installed', 'auth-expired': 'Spotify needs to reconnect',
        unavailable: 'LMS unavailable', error: 'SpotOn error' };
    function request(path, body, signal) {
        return fetch('/spotify/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}), signal: signal || AbortSignal.timeout(35000) }).then(function (r) {
            return r.json().then(function (value) { if (!r.ok || value.error) throw new Error(value.error || 'Spotify unavailable'); return value; });
        });
    }
    function cover(url) {
        return $('<img class="spotify-cover" alt="">').attr('src', url || '/IMG/Record.png').on('error', function () {
            this.onerror = null; $(this).off('error').attr('src', '/IMG/Record.png');
        });
    }
    function button(label, callback) { return $('<button type="button">').text(label).on('click', callback); }
    function message(error) { if (typeof showToast === 'function') showToast(error.message || String(error)); }
    function refresh() {
        return request('status').then(function (value) {
            state = value;
            if(typeof spotifySettingsUI !== 'undefined')spotifySettingsUI.refresh();
            return value;
        }).catch(function () {
            state=null;
            if(typeof spotifySettingsUI !== 'undefined')spotifySettingsUI.refresh();
        });
    }
    function action(item, name) {
        return request('queue', { action: name, song: item.song, album: item.bookmark, key: item.song ? undefined : item.key })
            .then(function (r) { if (r.cancelled) return; message({ message: name === 'sticky' ? 'Added Spotify sticky' : 'Spotify: ' + r.count + ' track(s)' }); })
            .catch(message);
    }
    function row(item, nested) {
        var actions = item.song ? {
            play:function(){action(item,'play');},add:function(){action(item,'add');},sticky:function(){action(item,'sticky');}
        } : {open:function(){open(item, nested);}};
        if (!item.song && item.kind === 'album') {
            actions.play=function(){action(item,'play');};
            actions.add=function(){action(item,'add');};
            actions.sticky=function(){action(item,'sticky');};
        }
        return randyUI.row(Object.assign({},item,{source:'spotify'}),actions);
    }
    function libraryAction(item,name) {
        return request('queue',{action:name,song:item.song,key:item.song?undefined:item.key})
            .then(function(result){if(!result.cancelled)message({message:name==='sticky'?'Added Spotify sticky':'Spotify: '+result.count+' track(s)'});})
            .catch(function(){message({message:'Could not update your Spotify queue or bookmarks. Please try again.'});});
    }
    function libraryRow(item,onOpen) {
        var actions=item.song?{play:function(){libraryAction(item,'play');},add:function(){libraryAction(item,'add');},sticky:function(){libraryAction(item,'sticky');}}
            :{open:function(){onOpen(item);}};
        return randyUI.row(Object.assign({},item,{source:'spotify'}),actions);
    }
    function backFromSpotify() {
        ++browseGeneration; // A late child response must not overwrite its parent.
        if (spotifyBrowseHistory.length) {
            var previous = spotifyBrowseHistory.pop();
            $('#browse-spotify').empty().append(previous.content);
            browsepane('spotify', {scrollTop:previous.scroll});
        } else browsepane('search-results');
    }
    function open(item, nested) {
        if (nested) {
            var parentScroll=$('#browse-modes').scrollTop();
            spotifyBrowseHistory.push({content:$('#browse-spotify').children().detach(),scroll:parentScroll});
        } else {
            spotifyBrowseHistory.forEach(function(previous){previous.content.remove();});
            spotifyBrowseHistory=[];
        }
        var token = ++browseGeneration;
        browsepane('spotify', {resetScroll:true});
        var pane = $('#browse-spotify').empty().append(button(spotifyBrowseHistory.length ? '< Back' : 'Back to search', backFromSpotify));
        pane.append($('<p>').text('Loading Spotify…'));
        request('browse', { key: item.key, all: true }).then(function (collection) {
            if (token !== browseGeneration) return;
            pane.find('p').remove();
            pane.append(cover(collection.artwork), $('<h3>').text(collection.title), $('<p>').text(collection.subtitle || collection.artist || ''));
            var spotifyId = /^(?:spoton:\/\/|spotify:)(track|album|playlist):([A-Za-z0-9]{22})$/.exec(collection.uri || '');
            if (spotifyId) pane.append($('<a class="randy-action" target="_blank" rel="noopener noreferrer" aria-label="Open in Spotify" title="Open in Spotify">').attr('href', 'https://open.spotify.com/' + spotifyId[1] + '/' + spotifyId[2]).html(randyUI.icon('external')));
            if ((collection.kind === 'album' || collection.kind === 'playlist') && collection.enumerable) {
                pane.append(button('Play ' + collection.kind, function () { action(item, 'play'); }),
                    button('Add ' + collection.kind, function () { action(item, 'add'); }));
            }
            if (collection.kind === 'album') pane.append(button('Bookmark album', function () { action(item, 'sticky'); }));
            if (collection.message) pane.append($('<p>').text(collection.message));
            else if (!collection.items.length) pane.append($('<p>').text('No tracks available.'));
            collection.items.forEach(function (entry) { pane.append(row(entry, true)); });
        }).catch(function (error) { if (token === browseGeneration) pane.append($('<p>').text(error.message)); });
    }
    function closeBrowse() {
        ++browseGeneration;
        spotifyBrowseHistory.forEach(function(previous){previous.content.remove();});
        spotifyBrowseHistory=[];
        $('#browse-spotify').empty();
    }
    function invalidate() {
        generation++; clearTimeout(searchTimer); if (controller) controller.abort();
        $('#spotify-search-results').empty();
        return generation;
    }
    function search(query) {
        invalidate(); // Repeated keyup events for one query must not append duplicate notices.
        var token = generation;
        if (query.trim().length < 2 || /^https?:/i.test(query) || !state || !state.connected || !state.includeSearch) return;
        controller = new AbortController();
        var abort = controller;
        searchTimer = setTimeout(function () {
            request('search', { keyword: query }, AbortSignal.any([abort.signal, AbortSignal.timeout(35000)]))
                .then(function (response) {
                    if (token !== generation) return;
                    var pane = $('#spotify-search-results').empty(), result = response.results;
                    ['tracks', 'albums', 'artists'].forEach(function (kind) {
                        if (!result[kind].length) return;
                        pane.append($('<h3 class="randy-result-heading">').attr('id','search-spotify-'+kind).attr('data-search-section','Spotify '+kind).attr('data-search-count',result[kind].length).text('Spotify · ' + kind));
                        result[kind].forEach(function (item) { pane.append(row(item)); });
                    });
                    if (result.message && state && state.includeSearch) pane.append($('<p class="spotify-notice">').text(result.message));
                    if(typeof window !== 'undefined' && window.randySearchNav)window.randySearchNav.refresh();
                }).catch(function (error) {
                    if (token === generation && error.name !== 'AbortError' && state && state.includeSearch)
                        $('#spotify-search-results').text('Spotify search is temporarily unavailable.');
                });
        }, 350);
    }
    function useConnectTarget(index) {
        if (index != null) queueIndex = index;
        if (ownership !== 'spotify_connect' && ownership !== 'transitioning' && !(ownership === 'disconnected' && lastWasConnect)) return false;
        // Retain duration/seek state without inserting a Connect item into Randy's queue.
        if (!connectTarget) connectTarget=$('<div>').append($('<div class="onesong-len">'), $('<div class="onesong-info">'));
        $('#songlist .onesong-current').removeClass('onesong-current');
        if (typeof cursong !== 'undefined') cursong=connectTarget;
        return true;
    }
    function unlockChime() {
        try {
            var AudioContext=window.AudioContext || window.webkitAudioContext;
            if(!AudioContext)return;
            if(!chimeContext || chimeContext.state==='closed')chimeContext=new AudioContext();
            if(chimeContext.state==='suspended')chimeContext.resume().catch(function(){});
        } catch (_) { /* Audio is optional when browser permissions block it. */ }
    }
    function playConnectChime() {
        if(!chimeContext || chimeContext.state!=='running')return;
        try {
            var start=chimeContext.currentTime;
            [523.25,659.25].forEach(function(frequency,index){
                var oscillator=chimeContext.createOscillator(),gain=chimeContext.createGain();
                var at=start+index*.12;
                oscillator.type='sine';oscillator.frequency.value=frequency;
                gain.gain.setValueAtTime(0,at);
                gain.gain.linearRampToValueAtTime(.035,at+.015);
                gain.gain.exponentialRampToValueAtTime(.0001,at+.22);
                oscillator.connect(gain);gain.connect(chimeContext.destination);
                oscillator.start(at);oscillator.stop(at+.23);
                oscillator.onended=function(){oscillator.disconnect();gain.disconnect();};
            });
        } catch (_) { /* Never let a notification sound affect playback controls. */ }
    }
    document.addEventListener('pointerdown',unlockChime);
    document.addEventListener('keydown',unlockChime);
    function setOwnership(value) {
        ownership=value.state;
        if(ownership==='randy' || ownership==='disconnected' || value.playbackState==='stopped')connectAnnounced=false;
        if(ownership==='spotify_connect' && value.playbackState==='playing' && !connectAnnounced) {
            connectAnnounced=true;playConnectChime();
        }
        if (value.trackKey && value.trackKey !== connectTrack) {connectMetadata=null;connectTarget=null;connectTrack=value.trackKey;}
        connectStopped=value.playbackState === 'stopped';
        if (ownership !== 'spotify_connect') {connectMetadata=null;connectTrack=null;}
        updateConnectToast();
        if (ownership === 'spotify_connect') lastWasConnect=true;
        if (ownership === 'randy') lastWasConnect=false;
        $('#spotify-owner').text(({randy:'Randy',spotify_connect:'Spotify Connect',transitioning:'Transitioning',disconnected:'Disconnected'})[ownership] || ownership);
        if (!useConnectTarget()) {
            connectTarget=null;
            if (typeof cursong !== 'undefined') cursong=$('#song_'+queueIndex).addClass('onesong-current');
        }
    }
    function updateConnectToast() {
        var visible=ownership === 'spotify_connect' && !connectStopped;
        var title=visible && connectMetadata ? connectMetadata.title || '' : '';
        var album=visible && connectMetadata ? connectMetadata.albumName || '' : '';
        var artist=visible && connectMetadata ? connectMetadata.artist || '' : '';
        var details=[album,artist].filter(Boolean).join(' - ');
        var key=JSON.stringify([visible,title,details]);
        var toast=$('#spotify-connect-toast').prop('hidden',!visible);
        if(key!==lastToast) {
            lastToast=key;toast.empty();
            if(visible)toast.append($('<div class="connect-toast-heading">').html(randyUI.icon('spotify')+'<span>Spotify Connect</span>'),
                $('<div class="connect-toast-track">').text(title).attr('title',title),
                $('<div class="connect-toast-album">').text(details).attr('title',details));
        }
    }
    function updateNowPlaying(meta) {
        if(meta.source !== 'spotify_connect' || ownership !== 'spotify_connect')return;
        connectMetadata=meta;updateConnectToast();
    }
    function accountRemoved() {
        var showingSpotify=lastWasConnect || $('#songlist .onesong-current .randy-source[title="Spotify"]').length;
        invalidate();closeBrowse();setOwnership({state:'disconnected'});
        if(showingSpotify) {
            $('.album-art').css('background-image','url("/IMG/Record.png")');
            $('#browse-zen').empty();document.title='Randy';
        }
        refresh();
    }
    document.addEventListener('error', function (event) {
        var image = event.target;
        if (image.tagName === 'IMG' && (image.classList.contains('spotify-cover') || (image.getAttribute('src') || '').indexOf('/spotify/artwork?') === 0)) {
            if (image.getAttribute('src') !== '/IMG/Record.png') image.src = '/IMG/Record.png';
        }
    }, true);
    $(function () {
        refresh(); setInterval(refresh, 5000);
        if (typeof socket !== 'undefined') { socket.on('spotify-problem', message);socket.on('spotify-account-removed',accountRemoved); }
    });
    return { libraryRequest:request, libraryAction:libraryAction, libraryRow:libraryRow, albumAction:function(album,name){return action({bookmark:album},name);}, setOwnership:setOwnership, updateNowPlaying:updateNowPlaying, useConnectTarget:useConnectTarget, search: search, invalidate: invalidate, closeBrowse:closeBrowse, accountRemoved:accountRemoved, cover: cover, refresh: refresh,
        escape: function (value) { return String(value || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); } };
}());
