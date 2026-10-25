/* Music Library navigation stays inside the existing files pane. */
var libraryUI = (function () {
    'use strict';
    var source='local',history=[],local=null,localError=false,spotify={available:false},session=0,generation=0;
    var pane,content;
    function button(text,callback){return $('<button type="button" class="library-link">').text(text).on('click',callback);}
    function current(){return history[history.length-1];}
    function scroll(value){$('#browse-modes').scrollTop(value || 0);}
    function go(view){current().scroll=$('#browse-modes').scrollTop();history.push(view);render();}
    function back(){if(history.length>1){history.pop();render();}}
    function select(next){source=next;history=[{kind:'home',title:next==='local'?'Local':'Spotify'}];render();}
    function sources(){
        var tabs=pane.find('.library-sources').empty();
        ['local','spotify'].forEach(function(name){
            if(name==='spotify'&&!spotify.available)return;
            tabs.append($('<button type="button">').text(name==='local'?'Local':'Spotify').attr('aria-pressed',String(name===source)).on('click',function(){select(name);}));
        });
    }
    function localAction(name,path){socket.emit(name,path);if(name==='addtolist')showToast('Adding to the end of the playlist');}
    function track(item){return randyUI.row(item,{play:function(){localAction('playnow',item.path);},add:function(){localAction('addtolist',item.path);},sticky:function(){localAction('stick',item.path);}});}
    function album(item){return randyUI.row(Object.assign({},item,{source:'local'}),{
        open:function(){go({kind:'album',title:item.title,item:item});},play:function(){localAction('playnow',item.path);},
        add:function(){localAction('addtolist',item.path);},sticky:function(){localAction('stick',item.path);}});}
    function showAlbums(items){if(!items.length)content.append($('<p>').text('No albums yet.'));items.forEach(function(item){content.append(album(item));});}
    function render(){
        var token=++generation,view=current();
        pane=$('#browse-files').empty().addClass('music-library');
        pane.append($('<h3>').text('Music Library'),$('<div class="library-sources" role="group" aria-label="Library source">'));sources();
        if(history.length>1){
            var parent=history[history.length-2];
            pane.append($('<div class="library-nav">').append(button('‹ '+parent.title,back).attr('aria-label','Back to '+parent.title),$('<h4>').text(view.title).attr('title',view.title)));
        }
        content=$('<div class="library-content">');pane.append(content);scroll(view.scroll);
        if(source==='local'){
            if(localError){content.append($('<p role="status">').text('Could not load your music library. Please try again.'),button('Try again',open));return;}
            if(!local){content.text('Loading music library…');return;}
            if(view.kind==='home'){
                ['Artists','Albums','Tracks'].forEach(function(title){content.append(button(title,function(){go({kind:title.toLowerCase(),title:title});}));});
                if(!local.tracks.length)content.append($('<p>').text('Your local library is empty. Add a music source in Settings.'));
            } else if(view.kind==='artists'){
                if(!local.artists.length)content.append($('<p>').text('No artists yet.'));
                local.artists.forEach(function(artist){content.append(button(artist.title,function(){go({kind:'artist',title:artist.title,item:artist});}));});
            } else if(view.kind==='albums')showAlbums(local.albums);
            else if(view.kind==='artist')showAlbums(local.albums.filter(function(item){return view.item.albums.indexOf(item.path)!==-1;}));
            else if(view.kind==='tracks'){
                if(!local.tracks.length)content.append($('<p>').text('No tracks yet.'));
                local.tracks.forEach(function(item){content.append(track(item));});
            } else if(view.kind==='album'){
                if(view.data){renderAlbum(view.data);return;}
                content.text('Loading album…');
                api.getAlbum(view.item.path).then(function(result){if(token!==generation)return;view.data=result.results;content.empty();renderAlbum(view.data);scroll(view.scroll);})
                    .fail(function(){if(token===generation)content.text('Could not load this album. Please try again.');});
            }
        } else {
            if(!spotify.connected){
                content.append($('<p role="status">').text(spotify.message || 'Connect Spotify to view your library.'));
                content.append(button('Spotify Settings',function(){browsepane('settings');document.getElementById('spotify-native-settings')?.scrollIntoView({block:'start'});}));return;
            }
            if(view.kind==='home'){
                (spotify.items || []).forEach(function(item){content.append(button(item.title,function(){go({kind:'spotify-page',title:item.title,item:item});}));});
            } else renderSpotify(view,token);
        }
        function renderAlbum(data){
            content.append(randyUI.cover(data.albumart).addClass('album-detail-cover'));
            if(data.files.length)content.append(button('Play album',function(){localAction('playnow',view.item.path);}),button('Add album',function(){localAction('addtolist',view.item.path);}));
            else content.append($('<p>').text('This album is empty.'));
            data.files.forEach(function(file){content.append(track({source:'local',title:file.title || file.name,artist:file.artist,album:file.albumName,artwork:file.albumart,path:file.path}));});
        }
    }
    function renderSpotify(view,token){
        var target=content,collectionActions=$('<div class="library-collection-actions">').hide();
        if(view.item.kind==='playlist'){
            collectionActions.append(button('Play playlist',function(){spotifyUI.libraryAction(view.item,'play');}),button('Add playlist',function(){spotifyUI.libraryAction(view.item,'add');}));
            target.append(collectionActions);
        }
        var count=$('<p class="library-count">'),rows=$('<div>'),footer=$('<div>');target.append(count,rows,footer);
        function append(items){items.forEach(function(item){rows.append(spotifyUI.libraryRow(item,function(playlist){go({kind:'spotify-page',title:playlist.title,item:playlist});}));});}
        function controls(){
            footer.empty();
            collectionActions.toggle(view.items.some(function(item){return !!item.song;}));
            if(view.total!==null&&view.total!==undefined)count.text(view.total+' '+(view.item.kind==='library-playlists'?(view.total===1?'playlist':'playlists'):(view.total===1?'track':'tracks')));
            if(!view.items.length)footer.append($('<p>').text(view.message || (view.item.kind==='library-playlists'?'No playlists in your library.':view.item.kind==='library-liked'?'No Liked Songs yet.':'This playlist is empty or currently unavailable.')));
            if(view.hasMore)footer.append(button('Load more',load));
        }
        function load(){
            footer.empty().append($('<p role="status">').text('Loading…'));
            spotifyUI.libraryRequest('library',{section:'browse',key:view.item.key,offset:view.nextOffset || 0}).then(function(page){
                if(token!==generation)return;
                var items=page.items || [];view.items=(view.items || []).concat(items);view.nextOffset=page.nextOffset;view.hasMore=page.hasMore;view.total=page.total;view.message=page.message;view.loaded=true;
                append(items);controls();
            }).catch(function(){
                if(token!==generation)return;
                footer.empty().append($('<p role="status">').text('Could not load your Spotify library. Please try again.'),button('Try again',load));
            });
        }
        if(view.loaded){append(view.items);controls();scroll(view.scroll);}else load();
    }
    function open(){
        var visit=++session;local=null;localError=false;history=[{kind:'home',title:source==='local'?'Local':'Spotify'}];render();
        api.getLibrary().then(function(result){if(visit!==session)return;local=result.results;if(source==='local')render();}).fail(function(){if(visit!==session)return;localError=true;if(source==='local')render();});
        spotifyUI.libraryRequest('library',{section:'home'}).then(function(value){
            if(visit!==session)return;spotify=value;
            if(!spotify.available&&source==='spotify'){select('local');return;}
            sources();if(source==='spotify')render();
        }).catch(function(){
            if(visit!==session)return;
            if(source==='spotify'){spotify.connected=false;spotify.message='Spotify library is temporarily unavailable.';render();}
        });
    }
    return {open:open};
}());
