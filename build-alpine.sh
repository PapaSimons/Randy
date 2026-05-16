#!/bin/sh
# This script runs entirely inside an Alpine Linux container!

echo "######>>> Setting up workspace..."
mkdir -p overlay/etc/local.d
mkdir -p overlay/etc/runlevels/default

# Create the auto-install script that runs when the USB boots
cat << 'EOF' > overlay/etc/local.d/randy-wizard.start
#!/bin/sh
exec > /dev/tty1 2>&1
sleep 2
clear
echo "======================================================="
echo "       Welcome to the Randy OS Installer               "
echo "======================================================="
echo ""

echo "-> Waking up hardware drivers..."
mdev -s
sleep 2

WIFI_IF=$(ls /sys/class/net | grep -E '^wl|^wlan' | head -n 1)

if [ -z "$WIFI_IF" ]; then
    echo "ERROR: No Wi-Fi adapter detected! Hardware is invisible."
    exit 1
fi
echo "   [Found Wi-Fi]: $WIFI_IF"
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
echo "WARNING: $TARGET_DRIVE will be COMPLETELY WIPED."
read -p "Press Enter to begin installation..."

ip link set "$WIFI_IF" up
sleep 2

mkdir -p /etc/wpa_supplicant
cat <<WIFI > /etc/wpa_supplicant/wpa_supplicant.conf
network={
    ssid="$WIFI_SSID"
    psk="$WIFI_PASS"
}
WIFI

echo "-> Connecting to Wi-Fi..."
wpa_supplicant -B -i "$WIFI_IF" -c /etc/wpa_supplicant/wpa_supplicant.conf >/dev/null 2>&1
sleep 5
udhcpc -i "$WIFI_IF" -b -q >/dev/null 2>&1
sleep 5
echo "nameserver 1.1.1.1" > /etc/resolv.conf

if ! ping -c 1 dl-cdn.alpinelinux.org >/dev/null 2>&1; then
    echo "ERROR: Internet connection failed!"
    exit 1
fi
echo "   [Connected Successfully!]"

echo "-> Wiping and formatting drive (Native Alpine Sys Mode)..."
export ERASE_DISKS="$TARGET_DRIVE"
export BOOTLOADER="grub"
setup-disk -m sys -s 0 "$TARGET_DRIVE" >/dev/null 2>&1

echo "-> Drive formatted! Mounting to inject Randy..."
PART_ROOT=$(blkid | grep "$TARGET_DRIVE" | grep 'TYPE="ext4"' | cut -d: -f1)

mount "$PART_ROOT" /mnt
mount -t proc /proc /mnt/proc
mount --rbind /sys /mnt/sys
mount --rbind /dev /mnt/dev

cat <<INNER > /mnt/etc/network/interfaces
auto lo
iface lo inet loopback

auto $WIFI_IF
iface $WIFI_IF inet dhcp
INNER
cp /etc/wpa_supplicant/wpa_supplicant.conf /mnt/etc/wpa_supplicant/wpa_supplicant.conf
echo "nameserver 1.1.1.1" > /mnt/etc/resolv.conf

echo "-> Installing Node.js, Audio Tools, and configuring system..."
chroot /mnt /bin/sh -c '
  echo "http://dl-cdn.alpinelinux.org/alpine/v3.19/main" > /etc/apk/repositories
  echo "http://dl-cdn.alpinelinux.org/alpine/v3.19/community" >> /etc/apk/repositories
  apk update >/dev/null
  apk add linux-firmware nodejs npm gcompat alsa-utils mpv yt-dlp curl tar wpa_supplicant avahi openssh eudev sudo >/dev/null
  
  adduser -D -s /bin/sh randy
  echo "randy:randy" | chpasswd
  adduser randy audio
  adduser randy wheel
  echo "%wheel ALL=(ALL) ALL" > /etc/sudoers.d/wheel
  
  cat <<INNERASOUND > /etc/asound.conf
defaults.pcm.card 1
defaults.ctl.card 1
pcm.!default {
    type plug
    slave.pcm hw
}
INNERASOUND
  
  rc-update add networking boot >/dev/null
  rc-update add wpa_supplicant boot >/dev/null
  rc-update add avahi-daemon default >/dev/null
  rc-update add sshd default >/dev/null
  rc-update add udev sysinit >/dev/null
  
  LOC=$(curl -s https://api.github.com/repos/papasimons/Randy/releases/latest | grep "tag_name" | awk "{print \"https://github.com/papasimons/Randy/archive/\" substr(\$2, 2, length(\$2)-3) \".tar.gz\"}")
  curl -s -L -o /tmp/randy.tar.gz $LOC
  mkdir -p /opt/Randy
  tar xzf /tmp/randy.tar.gz --strip 1 -C /opt/Randy
  cd /opt/Randy && npm install >/dev/null 2>&1
  chown -R randy:randy /opt/Randy
  
  cat <<INNERSV > /etc/init.d/randy-node
#!/sbin/openrc-run
name="randy-node"
command="/usr/bin/node"
command_args="/opt/Randy/index.js"
command_background=true
command_user="randy:randy"
pidfile="/run/randy-node.pid"
INNERSV
  chmod +x /etc/init.d/randy-node
  rc-update add randy-node default >/dev/null
'

echo "-> Finalizing writes to SSD..."
sync
sleep 2
umount -l /mnt/dev /mnt/sys /mnt/proc
umount -l /mnt

echo "======================================================="
echo " Installation Complete!"
echo "======================================================="
read -p "Remove the USB drive and press Enter to reboot."
reboot
EOF
chmod +x overlay/etc/local.d/randy-wizard.start
ln -s /etc/init.d/local overlay/etc/runlevels/default/local

echo "######>>> Packaging the apkovl..."
cd overlay
tar -czf ../localhost.apkovl.tar.gz *
cd ..
rm -rf overlay

echo "######>>> Cloning Alpine Aports for mkimage..."
git config --global user.name "Randy Builder"
git config --global user.email "build@randyos.com"
git clone --depth=1 https://github.com/alpinelinux/aports.git

echo "######>>> Creating Custom Randy Profile..."
cat << 'EOF' > aports/scripts/mkimg.randy.sh
profile_randy() {
    profile_standard
    title="Randy OS"
    desc="Minimal Audiophile NodeOS Installer"
    profile_abuild="randy"
    # THE MAGIC HAPPENS HERE:
    apks="$apks linux-firmware wpa_supplicant util-linux e2fsprogs dosfstools grub-efi"
}
EOF

# FIX: Create a non-root user specifically to appease Alpine's security checks
echo "######>>> Setting up builder user (Alpine refuses to compile as root)..."
adduser -D -G abuild builder
chown -R builder:abuild /workspace

echo "######>>> Compiling the Custom ISO..."
# Generate keys and run the compiler as the new 'builder' user
su builder -c "abuild-keygen -n"
cp /home/builder/.abuild/*.rsa.pub /etc/apk/keys/
echo "PACKAGER_PRIVKEY=\"$(ls /home/builder/.abuild/*.rsa | head -n 1)\"" >> /etc/abuild.conf

cd aports/scripts
su builder -c "sh mkimage.sh \
  --tag v3.19 \
  --outdir ../../ \
  --arch x86_64 \
  --repository http://dl-cdn.alpinelinux.org/alpine/v3.19/main \
  --profile randy"

cd ../../
echo "######>>> Injecting the Auto-Installer..."
xorriso -indev alpine-randy-v3.19-x86_64.iso \
        -outdev randy-os-installer.iso \
        -map localhost.apkovl.tar.gz /localhost.apkovl.tar.gz \
        -boot_image any replay >/dev/null 2>&1

chmod 777 randy-os-installer.iso
echo "######>>> Build Complete!"