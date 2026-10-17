/* Shared Randy item presentation. Source is a small secondary indicator. */
var randyUI = (function () {
    'use strict';
    var paths = {
        play:'M8 5l11 7-11 7z', add:'M12 5v14M5 12h14',
        sticky:'M6 3h12v18l-6-4-6 4z',
        spotify:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M6 9c4-2 8-2 12 0M7 12c3-1.5 7-1.5 10 0M8 15c3-1 5-1 8 0',
        local:'M4 4h16v16H4zM8 8h8M8 12h5',
        external:'M14 3h7v7M21 3l-11 11M10 3H3v18h18v-7',
        settings:'M4 7h16M4 17h16M9 4v6M15 14v6', remove:'M5 6h14M9 6V3h6v3M7 6l1 15h8l1-15'
    };
    function escape(value) {return String(value || '').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
    function icon(name,label) {return '<svg class="randy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" '+(label?'role="img" aria-label="'+escape(label)+'"':'aria-hidden="true"')+'><path d="'+(paths[name] || paths.local)+'"/></svg>';}
    function coverUrl(value,size) {
        value=value || '/IMG/Record.png';
        if (value.indexOf('/spotify/artwork?')===0) {var url=new URL(value,window.location.origin);url.searchParams.set('size',size || 300);return url.pathname+url.search;}
        return value;
    }
    function cover(value) {return $('<img class="randy-cover spotify-cover" alt="" loading="lazy">').attr('src',coverUrl(value,300)).on('error',function(){this.onerror=null;$(this).off('error').attr('src','/IMG/Record.png');});}
    function actionButton(name,label,callback) {return $('<button type="button" class="randy-action">').attr('title',label).attr('aria-label',label).html(icon(name)).on('click',callback);}
    function sourceIcon(source) {if (source !== 'spotify') return ''; return '<span class="randy-source" title="'+(source==='spotify'?'Spotify':'Local')+'">'+icon(source==='spotify'?'spotify':'local',source==='spotify'?'Spotify':'Local')+'</span>';}
    function row(item,actions) {
        var el=$('<div class="search-result randy-item">').attr('data-source',item.source || 'local').append(cover(item.artwork));
        var title=$('<div class="search-result-name clickablelink">').append($('<span class="randy-item-title">').text(item.title),$('<span class="search-result-path">').text(item.subtitle || [item.artist,item.album].filter(Boolean).join(' · ')));
        if(actions.open)title.on('click',actions.open);else if(actions.play)title.on('click',actions.play);
        el.append(title,$('<span>').html(sourceIcon(item.source)));
        var controls=$('<div class="randy-item-actions">');
        [['play','Play'],['add','Add to queue'],['sticky','Sticky']].forEach(function(action){if(actions[action[0]])controls.append(actionButton(action[0],action[1],actions[action[0]]));});
        return el.append(controls);
    }
    return {icon:icon,escape:escape,coverUrl:coverUrl,cover:cover,row:row,actionButton:actionButton,sourceIcon:sourceIcon};
}());
