Welcome to Randy!

Randy is a minimalist music streamer and player for raspberry pi, linux and macos.

![Randy Player](/public/IMG/Randy_screenshot1.png)

# Play anything

Randy can play web radio, podcasts, soundcloud, mixcloud, and pretty much all music file types.

# Always playing something

Randy has a really efficient randomiser algorithm which makes sure that there is always something next in your playlist.

# Minimal, sexy and pure good sound

With Randy my main objective was to stay minimal, natural to use and with some cool delights. 
Sound quality is most important, I build my own amplifiers and speakers with the basic philosophy of as little things in the signal path as possible and Randy follows this philosophy as well.

# Raspberry pi and desktop apps

I am currently building Randy with RPI in mind and maybe as an desktop app later if it makes sense.
RPI will be vanilla Raspbian-lite with minimal dependencies and basic i2s DAC configurations.

This will probably be the first non-MPD RPI streamer and very minimalistic at this stage.
Instead of [MPD](https://www.musicpd.org/) I am using [MPV](https://mpv.io/) which is a beast of a video player, but has all the good stuff to put out amazing sound quality as well.

# Collaboration

If anyone is interested to collaborate or contribute let me know. 
This is a fun project with lots of possible enhancements, I'll probably need to do some code cleanup soon :)

# Installing Randy:

On Raspberry PI

Install raspberry pi os on your SD card and boot it up on the raspberry pi device.
From ssh, type in the following commands to download the install script.

```sh
curl -L https://raw.githubusercontent.com/PapaSimons/Randy/master/rpios_install.sh -o install.sh

sudo chmod +x ./install.sh

sudo ./install.sh
```

At the end of the installation you will have to reboot.
If everything goes well, you can go to your browser and type: http://randy/ into the search bar and it will load Randy.

Note on DACs - Randy is currently set to a USB DAC, if you have an i2s HAT DAC or something else you can follow the manufacturer instructions to set it up on raspberry pi OS.

On mac:

```sh
brew install mpv yt-dlp
```
