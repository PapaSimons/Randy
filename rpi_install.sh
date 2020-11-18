#!/bin/sh

echo "######>>> Starting"

echo "######>>> Expanding file system"
raspi-config --expand-rootfs

echo "######>>> updating and upgrading packages"
apt-get update -y
apt-get dist-upgrade -y

echo "######>>> getting latest youtube-dl"
wget https://yt-dl.org/downloads/latest/youtube-dl -O /usr/local/bin/youtube-dl
chmod a+rx /usr/local/bin/youtube-dl

echo "######>>> installing packages"
apt-get install -y nginx mpv exfat-fuse exfat-utils ntfs-3g
curl -sL https://deb.nodesource.com/setup_14.x | -E bash -
apt install -y nodejs npm

echo "######>>> setting usb soundcard"
cat <<EOF > /etc/asound.conf
defaults.pcm.card 1
defaults.ctl.card 1
EOF

echo "######>>> setting hostname"
cat <<EOF > /etc/hostname
randy
EOF

cat <<EOF > /etc/hosts
127.0.0.1       localhost
::1             localhost ip6-localhost ip6-loopback
ff02::1         ip6-allnodes
ff02::2         ip6-allrouters

127.0.1.1               randy
EOF

echo "######>>> setting nginx"
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

        root /home/pi/Randy/public;

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

echo "######>>> setting automount"
apt-get install -y pmount

cat <<EOF > /etc/udev/rules.d/usbstick.rules
ACTION=="add", KERNEL=="sd[a-z][0-9]", TAG+="systemd", ENV{SYSTEMD_WANTS}="usbstick-handler@%k"
EOF

cat <<EOF > /lib/systemd/system/usbstick-handler@.service
[Unit]
Description=Mount USB sticks
BindsTo=dev-%i.device
After=dev-%i.device

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/cpmount /dev/%I
ExecStop=/usr/bin/pumount /dev/%I
EOF

cat <<EOF > /usr/local/bin/cpmount
#!/bin/bash
if mountpoint -q /media/usb1
then
   if mountpoint -q /media/usb2
   then
      if mountpoint -q /media/usb3
      then
         if mountpoint -q /media/usb4
         then
             echo "######>>> No mountpoints available!"
             #You can add more if you need
         else
             /usr/bin/pmount --umask 000 --noatime -w --sync $1 usb4
         fi
      else
         /usr/bin/pmount --umask 000 --noatime -w --sync $1 usb3
      fi
   else
      /usr/bin/pmount --umask 000 --noatime -w --sync $1 usb2
   fi
else
   /usr/bin/pmount --umask 000 --noatime -w --sync $1 usb1
fi
EOF

chmod u+x /usr/local/bin/cpmount

echo "######>>> setting up pm2"

npm install pm2@latest -g
pm2 start /home/pi/Randy/index.js
env PATH=$PATH:/usr/bin /usr/local/lib/node_modules/pm2/bin/pm2 startup systemd -u pi --hp /home/pi
pm2 save

echo "######>>> lets reboot now"