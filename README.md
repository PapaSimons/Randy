Welcome to Randy!

### Playback backend

MPV remains the default (`npm start`). To select an already running LMS server
and connected Squeezelite player, use Node.js 22 or newer:

```sh
RANDY_PLAYER_BACKEND=lms LMS_SERVER_URL=http://127.0.0.1:9000 \
LMS_PLAYER_ID=02:52:41:4e:44:59 PORT=3000 npm start
```

`RANDY_PLAYER_BACKEND=mpv` explicitly selects MPV. `LMS_SERVER_URL` defaults to
`http://127.0.0.1:9000`; `LMS_PLAYER_ID` is required for LMS. The LMS backend
supports absolute local file paths accessible to the LMS host and direct
HTTP(S) internet radio streams. Other online sources are not supported yet.
Randy chooses each track; LMS shuffle/repeat are disabled. LMS and Squeezelite
must already be running. Randy does not manage their services or audio devices.
Radio station objects, selection and stickies remain owned by Randy. LMS's
`current_title` and `remote_title` supply live titles/station names when present;
otherwise Randy keeps the station title and artwork. Live streams have no
seekable duration and never trigger file EOF. A stream that fails to start
within 15 seconds reports a playback error and asks Randy to choose the next
track once; pause suspends that check, while stop and replacement cancel it.
An external stop after successful radio playback does not advance the queue. LMS handles
its native buffering/pause/resume; live pause is not guaranteed to retain the
same point in the broadcast. Stream failures after startup cannot reliably be
distinguished from external stops and do not trigger automatic advancement.
MPV device settings and MPV-specific audio statistics are not available
through LMS. Closing the adapter releases polling without stopping
the external player. Local-file completion requires observed playback near a known duration
followed by stopped status; outages or insufficient observations may leave the
track selected rather than advance it. An external stop near the end cannot be
distinguished reliably from EOF. Failed local loads and JSON-RPC/connection
errors are reported without automatic skipping or replay. Run adapter/server
tests with `node --test test/*.test.js`.

Randy is a minimalist music streamer and player for raspberry pi, linux and macos.


<img width="1103" alt="image" src="https://user-images.githubusercontent.com/344467/236752516-34a21b4c-8e5e-47d3-b883-3935d08ccf0f.png">


### Play anything

Randy can play web radio, podcasts, many kinds of music streaming sites such as soundcloud, mixcloud and pretty much all music file types.

### Always playing something

Randy has a really efficient randomiser algorithm which makes sure that there is always something next in your playlist.

### Minimal, sexy and pure sound

With Randy my main objective was to stay minimal, natural to use and with some cool delights. 
Sound quality is most important, I build my own amplifiers and speakers with the basic philosophy of as little things in the signal path as possible and Randy follows this philosophy as well. So far Randy sounds great with my system and has been my workhorse player for the past few years.

### Raspberry pi and desktop apps

I am currently building Randy with RPI, SBC and thin clients in mind and maybe as an desktop app later for linux and macos if there is demand.

This will probably be the first non-MPD RPI streamer and very minimalistic at this stage.
Instead of [MPD](https://www.musicpd.org/) I am using [MPV](https://mpv.io/) which is a beast of a video player, but has all the good stuff to put out amazing sound quality as well. On top of that, it has a very efficient IPC connection and a direct pipe to yt-dlp which makes it easy to play just about anything off the web or your filesystems.

### Collaboration

If anyone is interested to collaborate or contribute let me know. 
This is a fun project with lots of possible enhancements :)

### Installing Randy

**On Raspberry PI or Other Linux devices**

Install [Ubuntu Server 32bit](https://ubuntu.com/download/server) or [Raspberry Pi OS lite](https://github.com/PapaSimons/Randy/wiki#raspberry-pi-os-lite-installation) on your device.

SSH into the new OS installation and type in the following commands to download and run the install script.

```sh
curl -L https://raw.githubusercontent.com/PapaSimons/Randy/master/install.sh -o install.sh

sudo chmod +x ./install.sh

sudo ./install.sh
```

- in Ubuntu server you can ignore the many blue services prompt and press enter -

At the end of the installation you will have to reboot.

If everything goes well, you can go to a computer or mobile browser on a device thats connected to the same wifi as Randy and type: [http://randy/](http://randy/) into the search bar and it will load Randy.

**Note on host name** - After the installation the hostname will be 'randy'.

**Note on OSes and Devices** - Randy has worked on RPI, Orange pi Zero, Intel NUC, HP T-520 Thin client and maybe others as well.

**Note on DACs** - Randy installation is currently set to a USB DAC, if you have an i2s HAT DAC or something else you can follow the manufacturer instructions to set it up on raspberry pi OS, or the one in the [wiki page](https://github.com/PapaSimons/Randy/wiki#i2s-dacs), and [here is a great tutorial for alloboss](https://howtohifi.com/how-to-set-up-allo-boss-dac-hat-headless-raspberry-pi/)

**On Macos**

Coming soon!

### Updating Randy

Randy has an experimental update script which you can run if you already have Randy installed and want to get the latest changes. 
The update script loads the new project files and maintains the playlist and stickies you already have.

```sh
curl -L https://raw.githubusercontent.com/PapaSimons/Randy/master/update.sh -o update.sh

sudo chmod +x ./update.sh

sudo ./update.sh
```

### Support the project

If you like Randy you can support the project [here!](https://www.buymeacoffee.com/randyplayer) 🫰
