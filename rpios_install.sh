#!/bin/sh

echo "-------------------------------------------"
echo "######>>> Starting RPIOS"
echo "-------------------------------------------"
echo "-------------------------------------------"
echo "######>>> Expanding file system"
echo "-------------------------------------------"

raspi-config --expand-rootfs

echo "-------------------------------------------"
echo "######>>> updating and upgrading packages"
echo "-------------------------------------------"

apt-get update -y
apt-get dist-upgrade -y

echo "-------------------------------------------"
echo "######>>> getting latest yt-dlp"
echo "-------------------------------------------"

sudo wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

echo "-------------------------------------------"
echo "######>>> installing packages"
echo "-------------------------------------------"

apt-get install -y mpv exfat-fuse exfat-utils ntfs-3g git

echo "-------------------------------------------"
echo "######>>> installing nodejs"
echo "-------------------------------------------"

sudo curl -sL https://deb.nodesource.com/setup_current.x | sudo bash -
apt-get install -y nodejs

echo "-------------------------------------------"
echo "######>>> Download the latest release of Randy"
echo "-------------------------------------------"

LOCATION=$(curl -s https://api.github.com/repos/papasimons/Randy/releases/latest \
| grep "tag_name" \
| awk '{print "https://github.com/papasimons/Randy/archive/" substr($2, 2, length($2)-3) ".tar.gz"}') \
; curl -L -o randy_release.tar.gz $LOCATION

mkdir Randy
tar xvfz randy_release.tar.gz --strip 1 -C Randy

echo "-------------------------------------------"
echo "######>>> installing Randy Dependencies"
echo "-------------------------------------------" 

npm install ./Randy

echo "-------------------------------------------"
echo "######>>> setting usb soundcard"
echo "-------------------------------------------"

cat <<EOF > /etc/asound.conf
defaults.pcm.card 1
defaults.ctl.card 1
EOF

echo "-------------------------------------------"
echo "######>>> setting hostname"
echo "-------------------------------------------"

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

echo "-------------------------------------------"
echo "######>>> setting automount"
echo "-------------------------------------------"

apt-get install -y pmount

cat <<EOF > /etc/systemd/system/usb-mount@.service
[Unit]
Description=Mount USB Drive on %i
[Service]
Type=oneshot
RemainAfterExit=true
ExecStart=/usr/bin/pmount -u 0000 /dev/%i /media/%i
ExecStop=/usr/bin/pumount /dev/%i
EOF

cat <<EOF > /etc/udev/rules.d/99-usb-mount.rules
ACTION=="add",KERNEL=="sd[a-z][0-9]*",SUBSYSTEMS=="usb",RUN+="/bin/systemctl start usb-mount@%k.service"
ACTION=="remove",KERNEL=="sd[a-z][0-9]*",SUBSYSTEMS=="usb",RUN+="/bin/systemctl stop usb-mount@%k.service"
EOF

echo "-------------------------------------------"
echo "######>>> setting up pm2"
echo "-------------------------------------------"

npm install pm2@latest -g
pm2 start /home/pi/Randy/index.js
pm2 startup
env PATH=$PATH:/usr/bin /usr/local/lib/node_modules/pm2/bin/pm2 startup systemd -u pi --hp /home/pi
pm2 save

echo "-------------------------------------------"
echo "######>>> set up spotify"
echo "-------------------------------------------"

curl -sL https://dtcooper.github.io/raspotify/install.sh | sh

echo "-------------------------------------------"
echo "######>>> remove un-needed packages"
echo "-------------------------------------------"

apt autoremove -y

echo "-------------------------------------------"
echo "######>>> lets reboot now"
echo "### to reboot type: sudo reboot now"
echo "-------------------------------------------"