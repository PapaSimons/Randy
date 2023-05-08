Welcome to Randy!

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

I am currently building Randy with RPI in mind and maybe as an desktop app later for linux and macos if there is demand.

This will probably be the first non-MPD RPI streamer and very minimalistic at this stage.
Instead of [MPD](https://www.musicpd.org/) I am using [MPV](https://mpv.io/) which is a beast of a video player, but has all the good stuff to put out amazing sound quality as well. On top of that, it has a very efficient IPC connection and a direct pipe to yt-dlp which makes it easy to play just about anything off the web or your filesystems.

### Collaboration

If anyone is interested to collaborate or contribute let me know. 
This is a fun project with lots of possible enhancements :)

### Installing Randy

**On Raspberry PI**

Install [Raspberry Pi OS lite](https://www.raspberrypi.com/software/) on a SD card and boot it up on your raspberry pi device.
[ssh](https://github.com/PapaSimons/Randy/wiki) into the new Pi and type in the following commands to download and run the install script.
**Note** After the installation the hostname will be 'randy' and unless you change username and password they will stay as 'pi' and 'raspberry'.

```sh
curl -L https://raw.githubusercontent.com/PapaSimons/Randy/master/rpios_install.sh -o install.sh

sudo chmod +x ./install.sh

sudo ./install.sh
```

At the end of the installation you will have to reboot.
If everything goes well, you can go to a computer or mobile browser on a device thats connected to the same wifi as Randy and type: [http://randy/](http://randy/) into the search bar and it will load Randy.

**Note on DACs** - Randy installation is currently set to a USB DAC, if you have an i2s HAT DAC or something else you can follow the manufacturer instructions to set it up on raspberry pi OS. [Here is a great tutorial for alloboss](https://howtohifi.com/how-to-set-up-allo-boss-dac-hat-headless-raspberry-pi/)

**On Macos**

Coming soon!

### Support the project

If you like Randy you can support the project [here!](https://www.buymeacoffee.com/randyplayer) 🫰
