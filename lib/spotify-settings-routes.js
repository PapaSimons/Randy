'use strict';
const {randomBytes}=require('node:crypto');
const {SpotifySettings}=require('./spoton-settings');
module.exports=function(app,{spotify,playlist,onAccountRemoved=()=>{}}) {
    const settings=new SpotifySettings(spotify);
    function origin(req) {
        const host=req.get('host');const url=new URL((req.protocol==='https'?'https':'http')+'://'+host);
        if(url.username || url.password || url.pathname!=='/')throw new Error('Invalid Randy address.');
        return url.origin;
    }
    const post=(path,handler)=>app.post('/spotify/settings/'+path,async(req,res)=>{
        res.set('Cache-Control','no-store');
        if(req.get('X-Requested-With')!=='XMLHttpRequest' || (req.get('origin') && req.get('origin')!==origin(req)))
            return res.status(403).json({error:'Open Spotify settings in Randy to continue.'});
        try {res.json(await handler(req.body || {},req));}
        catch(error) {
            // No raw plugin responses, callback URLs, Client IDs or request bodies.
            spotify.log?.('settings-error',{operation:path.split('/').pop(),category:require('./spotify-log').category(error)});
            res.status(400).json({error:error.spotifySettingsSafe?error.message:'LMS or SpotOn is unavailable. Please retry.'});
        }
    });
    app.get('/spotify/settings/status',async(req,res)=>{
        res.set('Cache-Control','no-store');
        try{res.json(await settings.status());}catch{res.json({available:false,state:'unavailable',account:{connected:false,present:false,name:''},playback:{authorized:false},clientId:{mode:'bundled'},includeInSearch:false});}
    });
    post('account/start',(_,req)=>settings.startAccount(origin(req)));
    post('account/complete',body=>settings.completeAccount(body.callbackURL));
    post('account/cancel',()=>settings.cancelAccount());
    post('account/remove',async body=>{const result=await settings.removeAccount(body.confirmed);onAccountRemoved();return result;});
    post('playback/start',()=>settings.startPlayback());
    post('playback/browser',()=>settings.startPlayback(true));
    post('playback/complete',body=>settings.completePlayback(body.callbackURL));
    post('playback/cancel',()=>settings.cancelPlayback());
    post('client-id/save',body=>settings.updateClientId(body.clientId));
    post('client-id/remove',()=>settings.updateClientId('',true));
    post('search',body=>{
        if(typeof body.enabled!=='boolean')throw new Error('Search preference must be on or off.');
        playlist.setSetting('spotifySearchEnabled',body.enabled);spotify.statusCache=null;return {success:true};
    });
    // SpotOn embeds this exact callback path in its PKCE state. Only forward
    // the short-lived callback to SpotOn's own exchange handler; never tokens.
    app.get('/plugins/SpotOn/settings/pkce/callback',async(req,res)=>{
        res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
        let success=false;
        if(!req.query.error) {
            try {
                const url=new URL('/plugins/SpotOn/settings/pkce/callback',origin(req));
                if(typeof req.query.code!=='string' || typeof req.query.state!=='string')throw new Error('Missing callback.');
                url.searchParams.set('code',req.query.code);url.searchParams.set('state',req.query.state);
                await settings.completeAccount(url.href);success=true;
            } catch { /* SpotOn validates the one-time nonce and exchanges the code. */ }
        } else settings.cancelAccount();
        const nonce=randomBytes(16).toString('hex');
        res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-"+nonce+"'");
        res.type('html').send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Randy · Spotify</title>'+ 
            '<style>body{font:16px system-ui;padding:32px;background:#eee;color:#222}main{max-width:420px;margin:auto;background:white;padding:24px;border-radius:10px}a{color:inherit}</style><main><h2>Spotify</h2><p>'+ 
            (success?'Spotify is connected. You can close this tab and return to Randy.':'Spotify authorization was cancelled or could not finish. Return to Randy and try again.')+
            '</p><a href="/">Return to Randy</a></main>'+(success?'<script nonce="'+nonce+'">setTimeout(function(){window.close()},1200)</script>':''));
    });
    return settings;
};
