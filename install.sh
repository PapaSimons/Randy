#!/bin/sh

echo "-------------------------------------------"
echo "######>>> Starting RPIOS"
echo "-------------------------------------------"

echo "######>>> Expanding file system (RPI OS)"

raspi-config --expand-rootfs

echo "######>>> prevent Ubuntu server popups"

apt-get remove -y needrestart

echo "-------------------------------------------"
echo "######>>> updating and upgrading packages"
echo "-------------------------------------------"

apt-get update -y
apt-get upgrade -y

echo "-------------------------------------------"
echo "######>>> installing base packages"
echo "-------------------------------------------"

INSTALL_PKGS="wget curl tar alsa alsa-utils make build-essential exfat-fuse exfat-utils ntfs-3g"
for i in $INSTALL_PKGS; do
  sudo apt-get install -y $i
done

echo "-------------------------------------------"
echo "######>>> installing mpv"
echo "-------------------------------------------"

curl https://non-gnu.uvt.nl/debian/uvt_key.gpg --output uvt_key.gpg
mv uvt_key.gpg /etc/apt/trusted.gpg.d
apt-get install -y apt-transport-https
sh -c 'echo "deb https://non-gnu.uvt.nl/debian $(lsb_release -sc) uvt" >> /etc/apt/sources.list.d/non-gnu-uvt.list'
apt-get -y update
apt-get install -y -t "o=UvT" mpv

if ! command -v mpv >/dev/null 2>&1; then
    echo "mpv latest was not installed. Installing mpv from apt-get"
    sudo apt-get install -y mpv
else
    echo "mpv latest installed."
fi

echo "-------------------------------------------"
echo "######>>> getting latest yt-dlp"
echo "-------------------------------------------"

sudo wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

echo "-------------------------------------------"
echo "######>>> installing nodejs"
echo "-------------------------------------------"

sudo curl -sL https://deb.nodesource.com/setup_current.x | sudo bash -
apt-get install -y nodejs npm

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
pcm.!default {
 type plug
 slave.pcm hw
}
EOF

rm .asoundrc

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
echo "######>>> setting automount usb drives"
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
echo "######>>> setting up systemd node deamon"
echo "-------------------------------------------"

USER_HOME=$(getent passwd "$(logname)" | cut -d: -f6)
NODE_DIR=$(which node)

cat <<EOF > /etc/systemd/system/randy-node.service
[Unit]
Description=Randy nodejs application daemon
After=network.target

[Service]
ExecStart=$NODE_DIR $USER_HOME/Randy/index.js
Restart=on-failure
Type=simple
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=randy-node

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl start randy-node
systemctl enable randy-node

echo "-------------------------------------------"
echo "######>>> remove un-needed packages"
echo "-------------------------------------------"

apt autoremove -y

echo "-------------------------------------------"
echo "######>>> lets reboot now"
echo "### to reboot type: sudo reboot now"
echo "-------------------------------------------"