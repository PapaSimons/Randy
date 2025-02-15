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

INSTALL_PKGS="wget curl tar alsa alsa-utils make build-essential exfat-fuse exfat-utils ntfs-3g policykit-1 udisks2 udev"
for i in $INSTALL_PKGS; do
  apt-get install -y $i
done

echo "-------------------------------------------"
echo "######>>> installing nodejs"
echo "-------------------------------------------"

apt-get install -y ca-certificates curl gnupg
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
NODE_MAJOR=22
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install nodejs -y

echo "-------------------------------------------"
echo "######>>> installing mpv"
echo "-------------------------------------------"

curl https://non-gnu.uvt.nl/debian/uvt_key.gpg --output uvt_key.gpg
mv uvt_key.gpg /etc/apt/trusted.gpg.d
apt-get install -y apt-transport-https
sh -c 'echo "deb https://non-gnu.uvt.nl/debian $(lsb_release -sc) uvt" >> /etc/apt/sources.list.d/non-gnu-uvt.list'
apt-get -y update
apt-get install -y -t "o=UvT" mpv
rm /etc/apt/sources.list.d/non-gnu-uvt.list

if ! command -v mpv >/dev/null 2>&1; then
    echo "mpv latest was not installed. Installing mpv from apt-get"
    apt-get install -y mpv
else
    echo "mpv latest installed."
fi

echo "-------------------------------------------"
echo "######>>> getting latest yt-dlp"
echo "-------------------------------------------"

wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp

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

# Create udev rules
echo "Creating udev rules..."
cat > /etc/udev/rules.d/99-usb-automount.rules << 'EOF'
ACTION=="add", SUBSYSTEMS=="usb", SUBSYSTEM=="block", ENV{ID_FS_USAGE}=="filesystem", \
    RUN{program}+="/usr/bin/systemd-mount --no-block --automount=yes --collect $devnode /media/%k"
EOF

# Create systemd service
echo "Creating automount systemd service..."
cat > /etc/systemd/system/usb-automount.service << 'EOF'
[Unit]
Description=USB Automount Service
After=udisks2.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/true

[Install]
WantedBy=multi-user.target
EOF

# Enable and start services
echo "Enabling and starting services..."
systemctl daemon-reload
systemctl enable udisks2
systemctl start udisks2
systemctl enable usb-automount
systemctl start usb-automount

# Reload udev rules
echo "Reloading udev rules..."
udevadm control --reload-rules
udevadm trigger

echo "USB drives should now automount on insertion."
echo "Mounted devices will appear in /media/"

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