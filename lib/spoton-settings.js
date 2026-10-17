'use strict';

// SpotOn's form handler invalidates tokens/caches; a raw pref write does not.
// Parse only that supported form's action and non-secret hidden routing fields.
const cheerio = require('cheerio');
const redirectUri = 'https://stiefenm.github.io/spoton/auth/';

async function setClientId(spotify, clientId) {
    if (typeof clientId !== 'string' || !/^[a-f0-9]{32}$/i.test(clientId.trim())) throw new Error('Enter a Spotify Client ID: exactly 32 hexadecimal characters');
    clientId = clientId.trim();
    const path = '/plugins/SpotOn/settings/basic.html';
    const response = await spotify.request(path + '?playerid=' + encodeURIComponent(spotify.playerId));
    const $ = cheerio.load(await response.text());
    const input = $('input[name="pref_clientId"]');
    const form = input.closest('form');
    if (input.length !== 1 || form.length !== 1) throw new Error('SpotOn Client ID settings form is unavailable');
    const action = new URL(form.attr('action') || path, spotify.base);
    if (action.origin !== spotify.base.origin || action.pathname !== path) throw new Error('Unexpected SpotOn settings form');
    const body = new URLSearchParams();
    for (const name of ['saveSettings', 'useAJAX', 'page', 'playerid', 'player']) {
        const field = form.find('input[name="' + name + '"]');
        if (field.length) body.set(name, field.attr('value') || '');
    }
    body.set('saveSettings', '1'); body.set('pref_clientId', clientId);
    // Preserve exactly the prefs touched unconditionally by the installed form.
    for (const name of ['bitrate', 'binary', 'normalization', 'diagnosticMode']) {
        const value = (await spotify.rpc(['pref', 'plugin.spoton:' + name, '?'], ''))._p2;
        if (['normalization', 'diagnosticMode'].includes(name)) {
            if (Number(value) === 1) body.set('pref_' + name, '1');
        } else if (value != null) body.set('pref_' + name, String(value));
    }
    await spotify.request(action.pathname + action.search, {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:body.toString()});
    const saved = (await spotify.rpc(['pref', 'plugin.spoton:clientId', '?'], ''))._p2;
    if (saved !== clientId) throw new Error('SpotOn did not save the Client ID; manage it in SpotOn settings');
    spotify.statusCache = null; spotify.cache.clear(); spotify.handles.clear(); spotify.blockedUntil = 0;
    return {success:true, reauthorizationRequired:true, redirectUri};
}
module.exports = {setClientId, redirectUri};
