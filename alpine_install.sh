#!/bin/sh

echo "#############################"
echo "######>>> Starting"
echo "#############################"

echo "#############################"
echo "######>>> updating and upgrading packages"
echo "#############################"

sudo apk update
sudo apk upgrade

echo "#############################"
echo "######>>> installing packages"
echo "#############################"

sudo apk add mpv youtube-dl nodejs npm nano rsync nginx alsa-utils alsa-utils-doc alsa-lib alsaconf fuse-exfat exfat-utils ntfs-3g pmount

echo "#############################"
echo "######>>> setting config.txt"
echo "#############################"

cat <<EOF > /etc/asound.conf
[pi3]
kernel=vmlinuz-rpi
initramfs initramfs-rpi
[pi3+]
kernel=vmlinuz-rpi
initramfs initramfs-rpi
[pi4]
enable_gic=1
kernel=vmlinuz-rpi4
initramfs initramfs-rpi4
[all]
arm_64bit=1
include usercfg.txt

disable_splash=1
boot_delay=0
dtparam=spi=on
enable_uart=1
gpu_mem=32
dtparam=audio=on
max_usb_current=1
EOF

echo "#############################"
echo "######>>> setting audio"
echo "#############################"

#add audio to user
addgroup $USER audio
addgroup root audio
#start alsa
rc-service alsa start
rc-update add alsa

cat <<EOF > /etc/modules
af_packet
ipv6
brcmfmac
snd-usb-audio
EOF

echo "#############################"
echo "######>>> setting hostname"
echo "#############################"

cat <<EOF > /etc/hostname
randy
EOF

cat <<EOF > /etc/hosts
127.0.0.1    randy randy.localdomain
EOF

echo "#############################"
echo "######>>> setting nginx"
echo "#############################"

#add configuration
cat <<EOF > /etc/nginx/nginx.conf
worker_processes  1;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    upstream backend {
        server localhost:8888;
    }

    server {
        listen 80;
        server_name randy;

        root /root/home/Randy/public;

        location / {
            try_files $uri @backend;
        }

        location @backend {
            proxy_pass http://backend;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            # Following is necessary for Websocket support
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
}
EOF

#add nginx process
rc-update add nginx

echo "#############################"
echo "######>>> setting automount"
echo "#############################"

cat <<EOF > /etc/udev/rules.d/99-usb-mount.rules
ACTION=="add",KERNEL=="sd[a-z][0-9]*",SUBSYSTEMS=="usb",RUN+="mkdir -p /media/%k && mount /dev/%k /media/%k"
ACTION=="remove",KERNEL=="sd[a-z][0-9]*",SUBSYSTEMS=="usb",RUN+="umount /media/%k && rm -R /media/%k"
EOF

echo "#############################"
echo "######>>> setting up pm2"
echo "#############################"

npm install pm2@latest -g
pm2 start /home/pi/Randy/index.js
pm2 startup
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup openrc -u pi --hp /home/pi
pm2 save

echo "#############################"
echo "######>>> lets reboot now"
echo "#############################"