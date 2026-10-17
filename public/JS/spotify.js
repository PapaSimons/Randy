/* Spotify browsing uses LMS/SpotOn only. No Spotify credentials enter Randy. */
var spotifyUI = (function () {
    'use strict';
    var ownership = 'randy', queueIndex = 0, lastWasConnect = false, connectMetadata = null, connectTrack = null, connectStopped = false;
    var state, generation = 0, searchTimer, controller, browseGeneration = 0;
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
            $('#spotify-account').text(value.connected && value.account ? value.account + ' · ' : '');
            var unavailable = ['unavailable', 'not-installed', 'error'].includes(value.state);
            $('#spotify-api-auth-status').text(unavailable ? labels[value.state] : value.connected ? 'Connected ✓' : labels[value.state] || 'Not connected');
            $('#spotify-playback-auth-status').text(unavailable ? 'Unavailable' : value.playbackAuthorized ? 'Connected ✓' : 'Not connected');
            $('#spotify-search-enabled').prop('checked', !!value.connected && !!value.includeSearch).prop('disabled', !value.connected);
            $('#spotify-settings-link').attr('href', value.settingsUrl || '').prop('hidden', !value.settingsUrl);
            return value;
        }).catch(function () {
            $('#spotify-account').text('');
            $('#spotify-api-auth-status').text('LMS unavailable');
            $('#spotify-playback-auth-status').text('Unavailable');
            $('#spotify-search-enabled').prop('checked', false).prop('disabled', true);
        });
    }
    function action(item, name) {
        return request('queue', { action: name, song: item.song, key: item.song ? undefined : item.key })
            .then(function (r) { if (r.cancelled) return; message({ message: name === 'sticky' ? 'Added Spotify sticky' : 'Spotify: ' + r.count + ' track(s)' }); })
            .catch(message);
    }
    function row(item) {
        var actions = item.song ? {
            play:function(){action(item,'play');},add:function(){action(item,'add');},sticky:function(){action(item,'sticky');}
        } : {open:function(){open(item);}};
        if (!item.song && item.kind === 'album') {
            actions.play=function(){action(item,'play');};
            actions.add=function(){action(item,'add');};
        }
        return randyUI.row(Object.assign({},item,{source:'spotify'}),actions);
    }
    function open(item) {
        var token = ++browseGeneration;
        browsepane('spotify');
        var pane = $('#browse-spotify').empty().append(button('Back to search', function () { browsepane('search-results'); }));
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
            if (collection.message) pane.append($('<p>').text(collection.message));
            else if (!collection.items.length) pane.append($('<p>').text('No tracks available.'));
            collection.items.forEach(function (entry) { pane.append(row(entry)); });
        }).catch(function (error) { if (token === browseGeneration) pane.append($('<p>').text(error.message)); });
    }
    function invalidate() {
        generation++; clearTimeout(searchTimer); if (controller) controller.abort();
        $('#spotify-search-results').empty();
        return generation;
    }
    function search(query) {
        invalidate(); // Repeated keyup events for one query must not append duplicate notices.
        var token = generation;
        if (query.trim().length < 2 || /^https?:/i.test(query)) return;
        controller = new AbortController();
        var abort = controller;
        searchTimer = setTimeout(function () {
            request('search', { keyword: query }, AbortSignal.any([abort.signal, AbortSignal.timeout(35000)]))
                .then(function (response) {
                    if (token !== generation) return;
                    var pane = $('#spotify-search-results').empty(), result = response.results;
                    ['tracks', 'albums', 'artists'].forEach(function (kind) {
                        if (!result[kind].length) return;
                        pane.append($('<h3 class="randy-result-heading">').text('Spotify · ' + kind));
                        result[kind].forEach(function (item) { pane.append(row(item)); });
                    });
                    if (result.message && state && state.includeSearch) pane.append($('<p class="spotify-notice">').text(result.message));
                }).catch(function (error) {
                    if (token === generation && error.name !== 'AbortError' && state && state.includeSearch)
                        $('#spotify-search-results').text('Spotify search is temporarily unavailable.');
                });
        }, 350);
    }
    function useConnectRow(index) {
        if (index != null) queueIndex = index;
        if (ownership !== 'spotify_connect' && ownership !== 'transitioning' && !(ownership === 'disconnected' && lastWasConnect)) return false;
        if (!$('#spotify-connect-nowplaying').length) {
            var card=$('<div id="spotify-connect-nowplaying" class="onesong onesong-current">');
            card.append($('<div class="onesong-details">').append($('<div class="onesong-tit">'), $('<div class="onesong-artist">'), $('<div class="onesong-info">')),
                $('<div class="onesong-len">'));
            $('#songlist').before(card);
        }
        $('#songlist .onesong-current').removeClass('onesong-current');
        if (typeof cursong !== 'undefined') cursong=$('#spotify-connect-nowplaying');
        return true;
    }
    function setOwnership(value) {
        ownership=value.state;
        if (value.trackKey && value.trackKey !== connectTrack) {connectMetadata=null;connectTrack=value.trackKey;}
        connectStopped=value.playbackState === 'stopped';
        if (ownership !== 'spotify_connect') {connectMetadata=null;connectTrack=null;}
        updateConnectToast();
        if (ownership === 'spotify_connect') lastWasConnect=true;
        if (ownership === 'randy') lastWasConnect=false;
        $('#spotify-owner').text(({randy:'Randy',spotify_connect:'Spotify Connect',transitioning:'Transitioning',disconnected:'Disconnected'})[ownership] || ownership);
        if (!useConnectRow()) {
            $('#spotify-connect-nowplaying').remove();
            if (typeof cursong !== 'undefined') cursong=$('#song_'+queueIndex).addClass('onesong-current');
        }
    }
    function updateConnectToast() {
        var visible=ownership === 'spotify_connect' && !connectStopped;
        var text=visible ? 'Spotify Connect'+(connectMetadata && connectMetadata.title ? ' · '+connectMetadata.title+(connectMetadata.artist ? ' — '+connectMetadata.artist : '') : '') : '';
        var toast=$('#spotify-connect-toast').prop('hidden',!visible);
        // Avoid re-announcing identical live-region text on every 250ms poll.
        if(toast.text()!==text)toast.text(text);
    }
    function updateNowPlaying(meta) {
        if(meta.source !== 'spotify_connect' || ownership !== 'spotify_connect')return;
        connectMetadata=meta;updateConnectToast();
    }
    document.addEventListener('error', function (event) {
        var image = event.target;
        if (image.tagName === 'IMG' && (image.classList.contains('spotify-cover') || (image.getAttribute('src') || '').indexOf('/spotify/artwork?') === 0)) {
            if (image.getAttribute('src') !== '/IMG/Record.png') image.src = '/IMG/Record.png';
        }
    }, true);
    $(function () {
        $('#spotify-search-enabled').on('change', function () {
            invalidate(); request('preference', { enabled: this.checked }).then(refresh).catch(message);
        });
        refresh(); setInterval(refresh, 5000);
        if (typeof socket !== 'undefined') { socket.on('spotify-problem', message); }
    });
    return { setOwnership:setOwnership, updateNowPlaying:updateNowPlaying, useConnectRow:useConnectRow, search: search, invalidate: invalidate, cover: cover, refresh: refresh,
        escape: function (value) { return String(value || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); } };
}());
