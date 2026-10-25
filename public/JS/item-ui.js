/* Shared Randy item presentation. Source is a small secondary indicator. */
var randyUI = (function () {
    'use strict';
    var paths = {
        home:'M3 10l9-7 9 7v11h-6v-7H9v7H3z',
        folder:'M3 6h7l2 3h9v12H3z',
        close:'M6 6l12 12M6 18L18 6', search:'M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
        back:'M15 5l-7 7 7 7', next:'M9 5l7 7-7 7',
        menu:'M4 6h16M4 12h16M4 18h16', check:'M5 12l4 4L19 6',
        spinner:'M12 3a9 9 0 1 1-9 9',
        play:'M8 5l11 7-11 7z', add:'M12 5v14M5 12h14',
        edit:'M4 16l-1 5 5-1L20 8l-4-4zM14 6l4 4',
        sticky:'M6 3h12v18l-6-4-6 4z',
        spotify:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M6 9c4-2 8-2 12 0M7 12c3-1.5 7-1.5 10 0M8 15c3-1 5-1 8 0',
        local:'M4 4h16v16H4zM8 8h8M8 12h5',
        external:'M14 3h7v7M21 3l-11 11M10 3H3v18h18v-7',
        settings:'M9.5 3h5l.5 2.5 2 1.2 2.4-.8 2.5 4.2-1.9 1.7v2.4l1.9 1.7-2.5 4.2-2.4-.8-2 1.2-.5 2.5h-5L9 20.5l-2-1.2-2.4.8-2.5-4.2L4 14.2v-2.4l-1.9-1.7 2.5-4.2 2.4.8 2-1.2zM15.5 13a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0', remove:'M5 6h14M9 6V3h6v3M7 6l1 15h8l1-15'
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
        var title=$('<div class="search-result-name clickablelink">').append($('<span class="randy-item-title">').append(sourceIcon(item.source),$('<span>').text(item.title)),$('<span class="search-result-path">').text(item.subtitle || [item.artist,item.album].filter(Boolean).join(' · ')));
        if(actions.open)title.on('click',actions.open);else if(actions.play)title.on('click',actions.play);
        el.append(title);
        var controls=$('<div class="randy-item-actions">');
        [['play','Play'],['add','Add to queue'],['sticky','Sticky']].forEach(function(action){if(actions[action[0]])controls.append(actionButton(action[0],action[1],actions[action[0]]));});
        return el.append(controls);
    }
    return {icon:icon,escape:escape,coverUrl:coverUrl,cover:cover,row:row,actionButton:actionButton,sourceIcon:sourceIcon};
}());

// Render static controls through the same icon definitions as dynamic rows.
if (typeof document.querySelectorAll === 'function') {
    document.querySelectorAll('[data-randy-icon]').forEach(function (element) {
        element.innerHTML = randyUI.icon(element.getAttribute('data-randy-icon'));
    });
}
