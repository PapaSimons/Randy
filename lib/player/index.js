'use strict';

// Backend selection belongs here; Randy retains ownership of the queue.
module.exports = function createPlayer(options = {}, dependencies) {
    const backend = options.backend || 'mpv';
    if (!['mpv', 'lms'].includes(backend)) throw new Error('Unknown playback backend: ' + backend);
    return require('./' + backend)(options, dependencies);
};
