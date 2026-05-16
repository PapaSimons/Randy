#!/bin/bash

echo "######>>> Setting up workspace..."
mkdir -p randy-installer-env/overlay/etc/local.d
mkdir -p randy-installer-env/overlay/etc/runlevels/default

# Create the auto-install script that runs when the USB boots
cat << 'EOF' > randy-installer-env/overlay/etc/local.d/randy-wizard.start
#!/bin/sh
exec > /dev/tty1 2>&1
sleep 2
clear
echo "======================================================="
echo "       Welcome to the Randy OS (Alpine) Installer      "
echo "======================================================="
echo ""

read -p "Enter your Wi-Fi Network Name (SSID): " WIFI_SSID
read -p "Enter your Wi-Fi Password: " WIFI_PASS

echo "-> Auto-detecting optimal installation drive..."
USB_DEV=$(awk '$2 ~ /^\/media/ {print $1}' /proc/mounts | head -n 1 | sed 's/[0-9]*$//')
TARGET_DRIVE=""
for d in /dev/nvme*n1; do [ -b "$d" ] && [ "$d" != "$USB_DEV" ] && TARGET_DRIVE="$d" && break; done
if [ -z "$TARGET_DRIVE" ]; then
    for d in /dev/sd*; do [ -b "$d" ] && echo "$d" | grep -Eq '^/dev/sd[a-z]$' && [ "$d" != "$USB_DEV" ] && TARGET_DRIVE="$d" && break; done
fi

if [ -z "$TARGET_DRIVE" ]; then
    echo "ERROR: Could not detect an internal drive."
    exit 1
fi

echo "   [Found Target Drive]: $TARGET_DRIVE"
echo ""
echo "WARNING: $TARGET_DRIVE will be COMPLETELY WIPED."
read -p "Press Enter to begin installation..."

# Connect to Wi-Fi temporarily to download nodejs
echo "-> Connecting to Wi-Fi..."
cat <<WIFI > /etc/wpa_supplicant/wpa_supplicant.conf
network={
    ssid="$WIFI_SSID"
    psk="$WIFI_PASS"
}
WIFI
wpa_supplicant -B -i wlan0 -c /etc/wpa_supplicant/wpa_supplicant.conf >/dev/null 2>&1
udhcpc -i wlan0 -q >/dev/null 2>&1

# Alpine's native, foolproof partition and format tool
echo "-> Wiping and formatting drive (Native Alpine Sys Mode)..."
export ERASE_DISKS="$TARGET_DRIVE"
export BOOTLOADER="grub"
setup-disk -m sys -s 0 "$TARGET_DRIVE"

echo "-> Drive formatted! Mounting to inject Randy..."
PART_ROOT=$(blkid | grep "$TARGET_DRIVE" | grep 'TYPE="ext4"' | cut -d: -f1)

mount "$PART_ROOT" /mnt
mount -t proc /proc /mnt/proc
mount --rbind /sys /mnt/sys
mount --rbind /dev /mnt/dev

echo "-> Installing Node.js, Audio Tools, and gcompat..."
chroot /mnt /bin/sh -c '
  echo "http://dl-cdn.alpinelinux.org/alpine/v3.19/main" > /etc/apk/repositories
  echo "http://dl-cdn.alpinelinux.org/alpine/v3.19/community" >> /etc/apk/repositories
  apk update >/dev/null
  apk add nodejs npm gcompat alsa-utils mpv yt-dlp curl tar wpa_supplicant avahi openssh eudev >/dev/null
  
  echo "-> Setting up Audio..."
  cat <<INNER > /etc/asound.conf
defaults.pcm.card 1
defaults.ctl.card 1
pcm.!default {
    type plug
    slave.pcm hw
}
INNER
  
  echo "-> Setting up Network..."
  cat <<INNER > /etc/network/interfaces
auto lo
iface lo inet loopback

auto wlan0
iface wlan0 inet dhcp
INNER
  rc-update add networking boot >/dev/null
  rc-update add wpa_supplicant boot >/dev/null
  rc-update add avahi-daemon default >/dev/null
  rc-update add sshd default >/dev/null
  rc-update add udev sysinit >/dev/null
  
  echo "-> Downloading Randy App..."
  LOC=$(curl -s https://api.github.com/repos/papasimons/Randy/releases/latest | grep "tag_name" | awk "{print \"https://github.com/papasimons/Randy/archive/\" substr(\$2, 2, length(\$2)-3) \".tar.gz\"}")
  curl -s -L -o /tmp/randy.tar.gz $LOC
  mkdir -p /opt/Randy
  tar xzf /tmp/randy.tar.gz --strip 1 -C /opt/Randy
  cd /opt/Randy && npm install >/dev/null 2>&1
  
  echo "-> Creating Randy Background Service..."
  cat <<INNER > /etc/init.d/randy-node
#!/sbin/openrc-run
name="randy-node"
command="/usr/bin/node"
command_args="/opt/Randy/index.js"
command_background=true
pidfile="/run/randy-node.pid"
INNER
  chmod +x /etc/init.d/randy-node
  rc-update add randy-node default >/dev/null
'

# Save Wi-Fi password to the new OS
cp /etc/wpa_supplicant/wpa_supplicant.conf /mnt/etc/wpa_supplicant/wpa_supplicant.conf

echo "-> Finalizing writes to SSD..."
sync
sleep 2
umount -l /mnt/dev /mnt/sys /mnt/proc
umount -l /mnt

echo ""
echo "======================================================="
echo " Installation Complete!"
echo "======================================================="
read -p "Remove the USB drive and press Enter to reboot."
reboot
EOF
chmod +x randy-installer-env/overlay/etc/local.d/randy-wizard.start

# Tell Alpine to run our script on boot
ln -s /etc/init.d/local randy-installer-env/overlay/etc/runlevels/default/local

echo "######>>> Packaging the Overlay..."
cd randy-installer-env/overlay
tar -czf ../localhost.apkovl.tar.gz *
cd ..
rm -rf overlay
echo "######>>> DONE!"