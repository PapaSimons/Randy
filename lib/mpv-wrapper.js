'use strict'

const {stat} = require('fs')
const {randomBytes} = require('crypto')
const {join} = require('path')
const {tmpdir} = require('os')
const {createConnection} = require('net')
const {spawn} = require('child_process')
const {MPVClient} = require('mpv-ipc')

const awaitSocket = (path, cb) => {
	const t = Date.now()
	const check = () => {
		stat(path, (err, stats) => {
			if (err) {
				if ((Date.now() - t) >= 5000) cb(err)
				else setTimeout(check, 250)
			} else {
				if (stats.isSocket()) return cb()
				cb(new Error('not a socket'))
			}
		})
	}
	setTimeout(check, 250)
}

const defaults = {
	id: null,
	socket: null,
	bin: 'mpv',
	args: []
}

const createPlayer = (opt, cb) => {
	if ('function' === typeof opt) {
		cb = opt
		opt = {}
	}
	opt = Object.assign({}, defaults, opt)

	const id = opt.id || randomBytes(10).toString('hex')
	const socketPath = opt.socket || join(tmpdir(), 'mpv-' + id)

	const proc = spawn(opt.bin, opt.args.concat([
		'--idle=yes',
		'--quiet',
		'--demuxer-max-bytes=4194304',
		'--demuxer-max-back-bytes=4194304',
		'--cache-secs=8',
		'--input-ipc-server=' + socketPath
	]), {
		stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
		shell: true 
	});
	// todo: handle spawn error

	awaitSocket(socketPath, (err) => {
		if (err) return cb(err)

        var sock = createConnection(socketPath, function(){
            console.log("mpv socket at: " + socketPath);
            sock.setKeepAlive(true,2000);
            sock.on('error', function(error) {
                console.log("Socket error: " + error);
            });
        });
        
        /*
        sock.on('close', function(error) {
            console.log("Socket closed: " + error);
        });*/
		const player = new MPVClient(sock)
		player.id = id
		cb(null, player)
	})
}

module.exports = createPlayer