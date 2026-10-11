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
	let timer
	const check = () => {
		stat(path, (err, stats) => {
			if (err) {
				if ((Date.now() - t) >= 5000) cb(err)
				else timer = setTimeout(check, 250)
			} else {
				if (stats.isSocket()) return cb()
				cb(new Error('not a socket'))
			}
		})
	}
	timer = setTimeout(check, 250)
	return () => clearTimeout(timer)
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
	let sock = null
	let closed = false
	let completed = false
	const finish = (err, player) => {
		if (completed || closed) return
		completed = true
		cb(err, player)
	}

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
	proc.on('error', finish)

	const cancelWait = awaitSocket(socketPath, (err) => {
		if (closed) return
		if (err) return finish(err)

        sock = createConnection(socketPath, function(){
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
		finish(null, player)
	})
	// Playback lifecycle remains in the adapter; expose only transport cleanup here.
	return {
		close: () => {
			closed = true
			cancelWait()
			if (sock) sock.destroy()
		}
	}
}

module.exports = createPlayer
