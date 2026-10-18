/* Randy controls the UI; SpotOn owns accounts, tokens and playback credentials. */
var spotifySettingsUI = (function () {
    'use strict';
    var state, pending=null, timer, popup, refreshing=false, busy=false, generation=0;
    function request(path, body) {
        return fetch('/spotify/settings/'+path,{method:body===undefined?'GET':'POST',cache:'no-store',
            headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},
            body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)})
            .then(function(response){return response.json().then(function(value){if(!response.ok || value.error)throw new Error(value.error || 'Spotify settings unavailable.');return value;});});
    }
    function note(text) {$('#spotify-settings-message').text(text || '').prop('hidden',!text);}
    function render(value) {
        state=value;
        var available=!!value.available,account=value.account || {},playback=value.playback || {},client=value.clientId || {};
        var error=({'not-installed':'SpotOn is not installed.',unavailable:'LMS is unavailable.',unsupported:'This SpotOn version needs an updated Randy settings adapter.',error:'SpotOn is unavailable.'})[value.state];
        $('#spotify-settings-unavailable').text(error || '').prop('hidden',available);
        $('#spotify-account-state').text(!available?'Unavailable':pending==='account'?'Connecting to Spotify…':account.connected?'✓':account.reconnectRequired?'Spotify needs to reconnect':'Not connected');
        $('#spotify-account-name').text(account.name || '').prop('hidden',!available || !account.present || !account.name);
        $('#spotify-account-start').prop('hidden',!!account.connected).prop('disabled',!available || busy || pending==='account')
            .text(account.present?'Reconnect':'Set up');
        $('#spotify-account-remove').prop('hidden',!account.present).prop('disabled',!available || busy || !!pending);
        $('#spotify-playback-state').text(!available?'Unavailable':pending==='playback'?'Waiting for Spotify authorization…':playback.authorized?'Enabled ✓':!account.present?'Requires Spotify Account':'Not enabled');
        $('#spotify-playback-start').prop('hidden',!!playback.authorized).prop('disabled',!available || !account.connected || busy || !!pending);
        $('#spotify-client-mode').text(!available?'Unavailable':client.mode==='custom'?'✓':'Using default Client ID').attr('aria-label',!available?'Unavailable':client.mode==='custom'?'Custom Client ID configured':'Using default Client ID');
        $('#spotify-account-state').attr('aria-label',available && account.connected?'Connected':'Spotify account status');
        $('#spotify-client-value').text(client.value || '').prop('hidden',!available || client.mode!=='custom' || !client.value);
        $('#spotify-redirect-uri').text(client.redirectUri || 'Unavailable for this SpotOn version.');
        $('#spotify-client-toggle').text(client.mode==='custom'?'Change':'Set up');
        $('#spotify-client-save').prop('disabled',!available || busy || !!pending);
        $('#spotify-client-remove').prop('hidden',client.mode!=='custom').prop('disabled',!available || busy || !!pending);
        $('#spotify-search-enabled').prop('checked',!!value.includeInSearch).prop('disabled',!available || !account.connected || busy);
        $('#spotify-auth-cancel').prop('hidden',!pending);
    }
    function stopPending() {
        pending=null;clearTimeout(timer);$('#spotify-auth-cancel').prop('hidden',true);$('#spotify-auth-open').prop('hidden',true);
        $('#spotify-account-fallback').prop('hidden',true);
        $('#spotify-playback-instructions').prop('hidden',true);
    }
    function refresh() {
        if(refreshing)return Promise.resolve(state);
        refreshing=true;
        return request('status').then(function(value){
            if(pending) {
                var result=value[pending] || {};
                if((pending==='account' && result.connected) || (pending==='playback' && result.authorized)) {
                    stopPending();if(popup && !popup.closed)popup.close();note('');
                    if(typeof spotifyUI!=='undefined'){spotifyUI.invalidate();spotifyUI.refresh();}
                } else if(['timeout','cancelled','mismatch','failed'].includes(result.authorization)) {
                    stopPending();note(result.authorization==='mismatch'?'Please authorize using the same Spotify account.':result.authorization==='timeout'?'Authorization timed out. Please retry.':'Authorization did not finish. Please retry.');
                }
            }
            render(value);return value;
        }).catch(function(error){render({available:false,state:'unavailable'});if(pending)note(error.message);})
            .finally(function(){refreshing=false;});
    }
    function poll(kind,externalBrowser) {
        clearTimeout(timer);pending=kind;var deadline=Date.now()+180000;
        $('#spotify-account-fallback').prop('hidden',kind!=='account');
        function tick() {
            if(pending!==kind)return;
            if(Date.now()>deadline) {cancel(true);return;}
            refresh().then(function(){
                if(pending===kind && externalBrowser && popup && popup.closed){cancel(false);return;}
                if(pending===kind)timer=setTimeout(tick,2000);
            });
        }
        tick();
    }
    function withBusy(operation) {
        if(busy)return Promise.resolve();busy=true;if(state)render(state);
        return operation().catch(function(error){note(error.message);}).finally(function(){busy=false;if(state)render(state);refresh();});
    }
    function openAuthorization(path,kind) {
        if(busy)return;
        // Reserve the tab synchronously, then sever opener so a plugin callback
        // cannot navigate Randy to LMS Settings. Polling handles completion.
        popup=window.open('about:blank','_blank');
        if(popup){popup.opener=null;popup.document.title='Connecting to Spotify';popup.document.body.textContent='Opening Spotify…';}
        note('Connecting to Spotify…');var token=++generation;
        withBusy(function(){return request(path,{}).then(function(value){
            if(token!==generation)return;
            if(popup && !popup.closed)popup.location.replace(value.url);
            else $('#spotify-auth-open').attr('href',value.url).prop('hidden',false);
            poll(kind,true);
        }).catch(function(error){if(popup && !popup.closed)popup.close();throw error;});});
    }
    function cancel(timeout) {
        ++generation;var kind=pending;stopPending();if(popup && !popup.closed)popup.close();
        note(timeout?'Authorization timed out. Please retry.':'Authorization cancelled.');
        if(kind)return request(kind==='account'?'account/cancel':'playback/cancel',{}).then(refresh).catch(function(){refresh();});
    }
    function complete(kind) {
        var input=$('#spotify-'+kind+'-callback'),callbackURL=input.val().trim();input.val('');
        withBusy(function(){return request(kind+'/complete',{callbackURL:callbackURL}).then(function(){stopPending();note('Authorization completed.');refresh();if(typeof spotifyUI!=='undefined')spotifyUI.refresh();});});
    }
    $(function(){
        $('#spotify-account-start').on('click',function(){openAuthorization('account/start','account');});
        $('#spotify-account-remove').on('click',function(){
            if(!window.confirm('Remove your Spotify account from Randy? You will need to connect it again.'))return;
            withBusy(function(){return request('account/remove',{confirmed:true}).then(function(){
                stopPending();note('Spotify account removed.');if(typeof spotifyUI!=='undefined')spotifyUI.accountRemoved();
            });});
        });
        $('#spotify-playback-start').on('click',function(){
            withBusy(function(){return request('playback/start',{}).then(function(value){
                $('#spotify-pairing-device').text(value.deviceName);
                $('#spotify-playback-instructions').prop('hidden',false);
                note('Follow the steps above to enable Spotify Connect.');poll('playback');
            });});
        });
        $('#spotify-account-complete').on('click',function(){complete('account');});
        $('#spotify-auth-cancel').on('click',function(){cancel(false);});
        function clientId(remove) {
            var value=$('#spotify-client-id').val().trim();
            withBusy(function(){return request(remove?'client-id/remove':'client-id/save',remove?{}:{clientId:value}).then(function(result){
                $('#spotify-client-id').val('');
                note(result.reauthorizationRequired?'Client ID updated. Please reconnect your Spotify account.':'Client ID saved.');
                if(typeof spotifyUI!=='undefined'){spotifyUI.invalidate();spotifyUI.refresh();}
            });});
        }
        $('#spotify-client-toggle').on('click',function(){
            var open=$(this).attr('aria-expanded')!=='true';
            $(this).attr('aria-expanded',String(open));
            $('#spotify-client-settings').prop('hidden',!open);
        });
        $('#spotify-client-save').on('click',function(){clientId(false);});
        $('#spotify-client-remove').on('click',function(){clientId(true);});
        $('#spotify-search-enabled').on('change',function(){
            var enabled=this.checked;
            if(typeof spotifyUI!=='undefined')spotifyUI.invalidate();
            withBusy(function(){return request('search',{enabled:enabled}).then(function(){
                if(typeof spotifyUI!=='undefined')return spotifyUI.refresh().then(function(){if(enabled)spotifyUI.search($('#search-bar').val());});
            });});
        });
        window.addEventListener('focus',function(){refresh();});
        document.addEventListener('visibilitychange',function(){if(!document.hidden)refresh();});
        refresh();
    });
    return {refresh:refresh,render:render};
}());
