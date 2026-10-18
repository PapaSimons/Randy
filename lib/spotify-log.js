'use strict';

// Deliberately exclude URLs, request bodies, account names and raw errors.
const fields = new Set(['previous','state','playback','stalled','connected','authorized',
    'connectAvailable','sessionHealthy','rateLimited','operation','command','category','code']);
function category(error) {
    const text=String(error?.message || '');
    if (Number(error?.code) === 429 || /rate.?limit|429/i.test(text)) return 'rate-limited';
    if (/auth|reconnect|credentials/i.test(text)) return 'authorization';
    if (/timeout|timed out/i.test(text) || error?.name === 'TimeoutError') return 'timeout';
    if (/fetch failed|ECONNREFUSED|network/i.test(text)) return 'connection';
    return 'request-failed';
}
function createLog(output = console) {
    return function(event, details = {}) {
        const safe={};
        for(const [key,value] of Object.entries(details)) {
            if(fields.has(key) && (typeof value === 'boolean' || typeof value === 'number' || value === null ||
                typeof value === 'string' && /^[a-z0-9_-]{1,50}$/i.test(value))) safe[key]=value;
        }
        const method=event.endsWith('error') || event === 'connect-stalled' ? 'warn' : 'log';
        output[method]('[Spotify] '+event+' '+JSON.stringify(safe));
    };
}
module.exports={createLog,category};
