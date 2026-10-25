'use strict';

// Only handles discovered through SpotOn's user-library feed enter this path.
module.exports = async function library({section='home',key,offset=0}={}) {
    const status=await this.status();
    if (!status.version) return {available:false,connected:false};
    if (!status.connected) return {available:true,connected:false,message:'Connect Spotify to view your library.'};
    await this.ready();
    if (section==='home') {
        const root=await this.items();
        const entry=(root.item_loop || []).find(item=>/\/musicfolder\.png$/.test(item.icon || item['icon-id'] || ''));
        const params=entry && this.params(entry);
        if (!params) return {available:false,connected:true};
        const feed=await this.items(params);
        const items=[];
        for (const [kind,title,icon] of [['liked','Liked Songs',/\/songs?\.png$/],['playlists','Playlists',/\/playlists?\.png$/]]) {
            const raw=(feed.item_loop || []).find(item=>icon.test(item.icon || item['icon-id'] || ''));
            const navigation=raw && this.params(raw);
            if (!navigation) continue;
            const item=this.remember({kind:'library-'+kind,title},navigation);
            this.handles.get(item.key).library=true;
            items.push(item);
        }
        return {available:items.length>0,connected:true,items};
    }
    if (section!=='browse' || !Number.isSafeInteger(Number(offset)) || Number(offset)<0) throw new Error('Invalid library request');
    const handle=this.handles.get(key);
    if (!handle?.library || Date.now()-handle.at>30*60000) throw new Error('Library view expired');
    offset=Number(offset);
    const feed=await this.items(handle.params,offset,50);
    const raw=feed.item_loop || [],items=[];
    for (const entry of raw) {
        const item=this.normalize(entry,handle.item.kind==='library-playlists'?'playlist':'track',handle.item);
        if (handle.item.kind==='library-playlists') {
            if (item.kind!=='playlist' || !item.uri || !item.key) continue;
            this.handles.get(item.key).library=true;
            items.push(item);
        } else if (item.song) items.push(item);
    }
    const count=Number(feed.count ?? feed.total);
    const unavailable=!items.length && raw.some(entry=>['text','textarea'].includes(entry.type));
    const total=!unavailable && Number.isSafeInteger(count) && count>=0?count:null;
    const nextOffset=offset+raw.length;
    return {...handle.item,items,total,nextOffset,hasMore:!unavailable && raw.length>0 && (total===null?raw.length===50:nextOffset<total),
        ...(unavailable?{message:'This library view is empty or currently unavailable.'}:{})};
};
