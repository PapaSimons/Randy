#!/bin/sh

echo "#############################"
echo "######>>> Starting"
echo "#############################"
echo "#############################"
echo "######>>> Expanding file system"
echo "#############################"

raspi-config --expand-rootfs

echo "#############################"
echo "######>>> updating and upgrading packages"
echo "#############################"

apt-get update -y
apt-get dist-upgrade -y

echo "#############################"
echo "######>>> getting latest youtube-dl"
echo "#############################"

wget https://yt-dl.org/downloads/latest/youtube-dl -O /usr/local/bin/youtube-dl
chmod a+rx /usr/local/bin/youtube-dl

echo "#############################"
echo "######>>> installing packages"
echo "#############################"

apt-get install -y nginx mpv exfat-fuse exfat-utils ntfs-3g

echo "#############################"
echo "######>>> installing nodejs (v14)"
echo "#############################"

sudo curl -sL https://deb.nodesource.com/setup_current.x | sudo bash -
apt-get install -y nodejs

echo "#############################"
echo "######>>> setting usb soundcard"
echo "#############################"

cat <<EOF > /etc/asound.conf
defaults.pcm.card 1
defaults.ctl.card 1
EOF

echo "######>>> setting hostname"
cat <<EOF > /etc/hostname
randy
EOF

cat <<EOF > /etc/hosts
127.0.0.1       randy
::1             localhost ip6-localhost ip6-loopback
ff02::1         ip6-allnodes
ff02::2         ip6-allrouters

127.0.1.1       randy
EOF

echo "#############################"
echo "######>>> setting nginx"
echo "#############################"

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

echo "#############################"
echo "######>>> setting automount"
echo "#############################"

apt-get install -y pmount

cat <<EOF > /etc/systemd/system/usb-mount@.service
[Unit]
Description=Mount USB Drive on %i
[Service]
Type=oneshot
RemainAfterExit=true
ExecStart=/usr/bin/pmount --umask 000 /dev/%i /media/%i
ExecStop=/usr/bin/pumount /dev/%i
EOF

cat <<EOF > /etc/udev/rules.d/99-usb-mount.rules
ACTION=="add",KERNEL=="sd[a-z][0-9]*",SUBSYSTEMS=="usb",RUN+="/bin/systemctl start usb-mount@%k.service"
ACTION=="remove",KERNEL=="sd[a-z][0-9]*",SUBSYSTEMS=="usb",RUN+="/bin/systemctl stop usb-mount@%k.service"
EOF

echo "#############################"
echo "######>>> setting up pm2"
echo "#############################"

npm install pm2@latest -g
pm2 start /home/pi/Randy/index.js
pm2 startup
env PATH=$PATH:/usr/bin /usr/local/lib/node_modules/pm2/bin/pm2 startup systemd -u pi --hp /home/pi
pm2 save

echo "#############################"
echo "######>>> remove unneeded packages"
echo "#############################"

apt autoremove -y

echo "#############################"
echo "######>>> lets reboot now"
echo "#############################"