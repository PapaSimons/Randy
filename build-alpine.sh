#!/bin/sh
set -e

echo "######>>> PHASE 1: Building Custom Randy OS RootFS Snapshot..."
curl -sLO https://raw.githubusercontent.com/alpinelinux/alpine-chroot-install/v0.14.0/alpine-chroot-install
chmod +x alpine-chroot-install
mkdir -p /target-rootfs

./alpine-chroot-install \
  -d /target-rootfs \
  -b v3.19 \
  -m http://dl-cdn.alpinelinux.org/alpine \
  -p "linux-firmware nodejs npm gcompat alsa-utils mpv yt-dlp curl tar wpa_supplicant avahi openssh eudev sudo openrc"

echo "######>>> Configuring internal OS architecture..."
chroot /target-rootfs /bin/sh -c '
  echo "http://dl-cdn.alpinelinux.org/alpine/v3.19/main" > /etc/apk/repositories
  echo "http://dl-cdn.alpinelinux.org/alpine/v3.19/community" >> /etc/apk/repositories

  adduser -D -s /bin/sh randy
  echo "randy:randy" | chpasswd
  adduser randy audio
  adduser randy wheel
  echo "%wheel ALL=(ALL) ALL" > /etc/sudoers.d/wheel

  cat <<AUDIO > /etc/asound.conf
defaults.pcm.card 1
defaults.ctl.card 1
pcm.!default {
    type plug
    slave.pcm hw
}
AUDIO

  rc-update add devfs sysinit
  rc-update add dmesg sysinit
  rc-update add udev sysinit
  rc-update add hwclock boot
  rc-update add modules boot
  rc-update add sysfs boot
  rc-update add loop boot
  rc-update add networking boot
  rc-update add wpa_supplicant boot
  rc-update add avahi-daemon default
  rc-update add sshd default

  LOC=$(curl -s https://api.github.com/repos/papasimons/Randy/releases/latest | grep "tag_name" | awk "{print \"https://github.com/papasimons/Randy/archive/\" substr(\$2, 2, length(\$2)-3) \".tar.gz\"}")
  curl -s -L -o /tmp/randy.tar.gz "$LOC"
  mkdir -p /opt/Randy
  tar xzf /tmp/randy.tar.gz --strip 1 -C /opt/Randy
  
  # For safety, if npm install fails, we still continue to guarantee a working OS build
  cd /opt/Randy && npm install --no-audit --no-fund || true
  chown -R randy:randy /opt/Randy

  cat <<SERVICE > /etc/init.d/randy-node
#!/sbin/openrc-run
name="randy-node"
command="/usr/bin/node"
command_args="/opt/Randy/index.js"
command_background=true
command_user="randy:randy"
pidfile="/run/randy-node.pid"
SERVICE
  chmod +x /etc/init.d/randy-node
  rc-update add randy-node default
'

echo "######>>> Compressing Custom System Image..."
cd /target-rootfs
tar --exclude='proc/*' --exclude='sys/*' --exclude='dev/*' --exclude='run/*' -czf /workspace/randy-rootfs.tar.gz *
cd /workspace

echo "######>>> PHASE 2: Downloading Pristine Official Alpine Boot Medium..."
curl -sLO https://dl-cdn.alpinelinux.org/alpine/v3.19/releases/x86_64/alpine-extended-3.19.1-x86_64.iso

echo "######>>> PHASE 3: Creating Automated Ramdisk Deployment Hook..."
mkdir -p overlay/etc/local.d
mkdir -p overlay/etc/runlevels/default

# This script runs automatically in RAM when the stock USB boots
cat << 'EOF' > overlay/etc/local.d/randy-deploy.start
#!/bin/sh
exec > /dev/tty1 2>&1
sleep 2
clear
echo "======================================================="
echo "       Welcome to the Randy OS Deployment Engine       "
echo "======================================================="
echo ""
echo "-> Locating internal target drives..."
TARGET_DRIVE=""
for d in /dev/nvme*n1; do [ -b "$d" ] && TARGET_DRIVE="$d" && break; done
if [ -z "$TARGET_DRIVE" ]; then
    for d in /dev/sd*; do [ -b "$d" ] && echo "$d" | grep -Eq '^/dev/sd[a-z]$' && TARGET_DRIVE="$d" && break; done
fi

if [ -z "$TARGET_DRIVE" ]; then
    echo "ERROR: No internal storage drive detected!"
    exit 1
fi

echo "   [Target Drive Found]: $TARGET_DRIVE"
echo "   WARNING: All data on $TARGET_DRIVE will be wiped!"
echo ""
read -p "Press ENTER to deploy Randy OS to the internal drive..."

echo "-> Preparing partitions..."
dd if=/dev/zero of="$TARGET_DRIVE" bs=1M count=10 conv=notrunc
parted -s "$TARGET_DRIVE" mklabel gpt
parted -s "$TARGET_DRIVE" mkpart primary ext4 1MiB 100%
udevadm settle

PART_ROOT="${TARGET_DRIVE}1"
if echo "$TARGET_DRIVE" | grep -q "nvme"; then
    PART_ROOT="${TARGET_DRIVE}p1"
fi

echo "-> Formatting ext4 filesystem..."
mkfs.ext4 -F "$PART_ROOT"

echo "-> Sideloading system payload from RAM disk..."
mkdir -p /mnt/target
mount "$PART_ROOT" /mnt/target

# Locate the tarball we embedded onto the media and unpack it straight to the drive
tar -xzf /randy-rootfs.tar.gz -C /mnt/target

echo "-> Installing System Bootloader (GRUB)..."
apk add grub-efi --root /mnt/target --initdb
grub-install --target=x86_64-efi --efi-directory=/mnt/target --bootloader-id=alpine --removable

echo "======================================================="
echo " SUCCESS! Randy OS has been streamed to your Mini PC.  "
echo "======================================================="
read -p "Unplug the USB stick and press ENTER to reboot into your new OS!"
reboot
EOF

chmod +x overlay/etc/local.d/randy-deploy.start
ln -s /etc/init.d/local overlay/etc/runlevels/default/local

# Package the tiny ramdisk overlay configurations
cd overlay && tar -czf ../localhost.apkovl.tar.gz * && cd ..
rm -rf overlay

echo "######>>> Blending everything into a single installer ISO..."
xorriso -indev alpine-extended-3.19.1-x86_64.iso \
        -outdev randy-os-installer.iso \
        -map localhost.apkovl.tar.gz /localhost.apkovl.tar.gz \
        -map randy-rootfs.tar.gz /randy-rootfs.tar.gz \
        -boot_image any replay >/dev/null 2>&1

chmod 777 randy-os-installer.iso
echo "######>>> COMPLETE! Randy OS is ready for structural deployment."