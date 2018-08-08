Welcome to Randy!

Randy is a minimalist music streamer and player based on Nodejs and MPV.

![Randy Player July18](/images/Randy.png)

# Play anything

[MPV](https://mpv.io/) with the help of [Youtube-dl](https://rg3.github.io/youtube-dl/) and [FFmpeg](https://www.ffmpeg.org/) can pretty much play anything you throw at them.
Therefore, Randy can play web radio, podcasts, soundcloud, mixcloud, almost all music file types.

# Always playing something

Randy has a really efficient randomiser algorithm which makes sure that there is always something next in your playlist.

# Minimal, sexy and pure good sound

With Randy my main objective was to stay minimal, natural to use and with some cool delights. 
Sound quality is most important, I build my own amplifiers and speakers with the basic philosophy of as little things in the signal path as possible and Randy follows this philosophy as well.

# Raspberry pi and Electron

I am currently building Randy with RPI in mind and maybe as an Electron app later if it makes sense.
RPI will be vanilla Raspbian-lite with minimal dependencies and basic i2s DAC configurations.

This will probably be the first non-MPD RPI streamer and very minimalistic at this stage.
Instead of [MPD](https://www.musicpd.org/) I am using [MPV](https://mpv.io/) which is a beast of a video player, but has all the good stuff to put out amazing sound quality as well.

# Collaboration

If anyone is interested to collaborate or contribute let me know. 
This is a fun project with lots of possible enhancements, I'll probably need to do some code cleanup soon :)

# Starting to use for now:

You'll need to have mpv and youtube-dl installed first.

On mac:

```sh
brew install mpv youtube-dl
```

On linux:

```sh
sudo apt-get update
sudo apt-get dist-upgrade
sudo apt-get install mpv youtube-dl
```

After that clone this repository into a directory on your computer or RPI and CD into that directory and run

```sh
npm install
```
Start Randy:
```sh
npm start
```

RPI specific instructions will be coming soon! 
Meanwhile you can check out [this cool wiki page](https://github.com/guussie/PiDS/wiki/09.-How-to-make-various-DACs-work) on getting your DAC to work.
