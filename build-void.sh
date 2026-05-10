#!/bin/bash

echo "######>>> Setting up workspace..."
mkdir -p randy-installer-env
cd randy-installer-env

# Pre-create the target file with .gz extension
touch randy-os-intel.tar.gz
chmod 777 randy-os-intel.tar.gz

echo "######>>> Generating the Void OS setup script..."
cat << 'EOF' > randy-setup.sh
#!/bin/sh

# Bypass the Fastly CDN entirely
mkdir -p /etc/xbps.d
echo "repository=https://repo-fi.voidlinux.org/current" > /etc/xbps.d/00-repository-main.conf

rm -rf /var/cache/xbps/* 2>/dev/null
rm -f /var/db/xbps/https* 2>/dev/null

xbps-install -S -f -y
xbps-install -u -y xbps

rm -rf /var/cache/xbps/* 2>/dev/null
rm -f /var/db/xbps/https* 2>/dev/null
xbps-install -S -f -y
xbps-install -Su -y

# Install core dependencies (using linux-firmware-network to save space over full linux-firmware)
xbps-install -y wget curl tar alsa-utils make base-devel ntfs-3g udisks2 eudev nodejs mpv yt-dlp udevil linux linux-firmware-network grub efibootmgr wpa_supplicant dhcpcd openssh avahi

# Set Hostname
echo "randy" > /etc/hostname
cat <<'HOSTS_EOF' > /etc/hosts
127.0.0.1 localhost
::1 localhost
127.0.1.1 randy
HOSTS_EOF

# Create 'randy' user
useradd -m -s /bin/bash -G wheel,audio,video,storage randy
echo "randy:randy" | chpasswd

# Configure Bit-Perfect Audio
cat <<'INNER_EOF' > /etc/asound.conf
defaults.pcm.card 1
defaults.ctl.card 1
pcm.!default {
    type plug
    slave.pcm hw
}
INNER_EOF
rm -f .asoundrc

# Download and install Node App
LOCATION=$(curl -s https://api.github.com/repos/papasimons/Randy/releases/latest | grep "tag_name" | awk '{print "https://github.com/papasimons/Randy/archive/" substr($2, 2, length($2)-3) ".tar.gz"}')
curl -L -o randy_release.tar.gz $LOCATION
mkdir -p /opt/Randy
tar xvfz randy_release.tar.gz --strip 1 -C /opt/Randy
cd /opt/Randy && npm install

# Automount Service
mkdir -p /etc/sv/devmon
cat <<'INNER_EOF' > /etc/sv/devmon/run
#!/bin/sh
exec 2>&1
exec devmon --automount --mount-dir /media
INNER_EOF
chmod +x /etc/sv/devmon/run

# Node Daemon Service
mkdir -p /etc/sv/randy-node
cat <<'INNER_EOF' > /etc/sv/randy-node/run
#!/bin/sh
exec 2>&1
exec /usr/bin/node /opt/Randy/index.js
INNER_EOF
chmod +x /etc/sv/randy-node/run

# Enable Services
ln -sf /etc/sv/devmon /etc/runit/runsvdir/default/devmon
ln -sf /etc/sv/randy-node /etc/runit/runsvdir/default/randy-node
ln -sf /etc/sv/sshd /etc/runit/runsvdir/default/sshd
ln -sf /etc/sv/dbus /etc/runit/runsvdir/default/dbus
ln -sf /etc/sv/avahi-daemon /etc/runit/runsvdir/default/avahi-daemon

# Cleanup
xbps-remove -Oo -y
rm -rf /var/cache/xbps/* 2>/dev/null
EOF
chmod +x randy-setup.sh

echo "######>>> Generating the Auto-Installer UI for the Mini PC..."
mkdir -p overlay/etc/profile.d
cat << 'EOF' > overlay/etc/profile.d/00-randy-wizard.sh
#!/bin/sh
sleep 2 
clear
echo "======================================================="
echo "           Welcome to the Randy OS Installer           "
echo "======================================================="
echo ""

read -p "Enter your Wi-Fi Network Name (SSID): " WIFI_SSID
read -p "Enter your Wi-Fi Password: " WIFI_PASS

echo ""
echo "Available drives:"
lsblk -d -n -o NAME,SIZE | grep -E "nvme|sda|sdb"
echo ""
read -p "Type the name of the target drive (e.g., nvme0n1 or sda): " DRIVE_NAME
TARGET_DRIVE="/dev/$DRIVE_NAME"

echo ""
echo "WARNING: $TARGET_DRIVE will be COMPLETELY WIPED."
read -p "Press Enter to begin installation..."

echo "-> Partitioning drive..."
parted -s $TARGET_DRIVE mklabel gpt
parted -s $TARGET_DRIVE mkpart ESP fat32 1MiB 513MiB
parted -s $TARGET_DRIVE set 1 boot on
parted -s $TARGET_DRIVE mkpart primary ext4 513MiB 100%

if echo "$TARGET_DRIVE" | grep -q "nvme"; then
    PART_EFI="${TARGET_DRIVE}p1"
    PART_ROOT="${TARGET_DRIVE}p2"
else
    PART_EFI="${TARGET_DRIVE}1"
    PART_ROOT="${TARGET_DRIVE}2"
fi

mkfs.fat -F32 $PART_EFI >/dev/null
mkfs.ext4 -F $PART_ROOT >/dev/null

echo "-> Mounting partitions..."
mkdir -p /mnt/randy
mount $PART_ROOT /mnt/randy
mkdir -p /mnt/randy/boot/efi
mount $PART_EFI /mnt/randy/boot/efi

echo "-> Unpacking Randy OS (This may take a few minutes)..."
PAYLOAD=$(find /media -name "randy-os-intel.tar.gz" 2>/dev/null | head -n 1)
tar -xzf "$PAYLOAD" -C /mnt/randy

echo "-> Configuring Wi-Fi..."
mkdir -p /mnt/randy/etc/wpa_supplicant
cat <<WIFI_EOF > /mnt/randy/etc/wpa_supplicant/wpa_supplicant-wlan0.conf
ctrl_interface=DIR=/run/wpa_supplicant GROUP=wheel
network={
    ssid="$WIFI_SSID"
    psk="$WIFI_PASS"
}
WIFI_EOF
ln -sf /etc/sv/wpa_supplicant /mnt/randy/etc/runit/runsvdir/default/wpa_supplicant
ln -sf /etc/sv/dhcpcd /mnt/randy/etc/runit/runsvdir/default/dhcpcd

echo "-> Configuring boot sector..."
UUID_ROOT=$(blkid -s UUID -o value $PART_ROOT)
UUID_EFI=$(blkid -s UUID -o value $PART_EFI)
cat <<FSTAB_EOF > /mnt/randy/etc/fstab
UUID=$UUID_ROOT / ext4 rw,relatime 0 1
UUID=$UUID_EFI /boot/efi vfat rw,relatime 0 2
FSTAB_EOF

mount -t proc /proc /mnt/randy/proc
mount --rbind /sys /mnt/randy/sys
mount --rbind /dev /mnt/randy/dev
chroot /mnt/randy grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=RandyOS >/dev/null 2>&1
chroot /mnt/randy xbps-reconfigure -fa >/dev/null 2>&1

umount -l /mnt/randy/dev /mnt/randy/sys /mnt/randy/proc
umount -R /mnt/randy

echo ""
echo "======================================================="
echo " Installation Complete!"
echo "======================================================="
read -p "Remove the USB drive and press Enter to reboot."
reboot
EOF
chmod +x overlay/etc/profile.d/00-randy-wizard.sh

cat << 'EOF' > overlay/etc/inittab
::sysinit:/sbin/openrc sysinit
::sysinit:/sbin/openrc boot
::wait:/sbin/openrc default
::ctrlaltdel:/sbin/reboot
::shutdown:/sbin/openrc shutdown
tty1::respawn:/bin/login -f root
EOF

cd overlay
tar -czf ../localhost.apkovl.tar.gz *
cd ..
rm -rf overlay

echo "######>>> Starting Docker build environment to compile the OS..."
docker run --rm --privileged -v $(pwd):/workspace alpine:latest sh -c '
    apk add --no-cache wget tar xz curl grep >/dev/null
    URL="https://repo-default.voidlinux.org/live/current/"
    LATEST_TAR=$(curl -s $URL | grep -o "void-x86_64-ROOTFS-[0-9]*.tar.xz" | head -n 1)
    
    mkdir -p /build_env
    cd /build_env
    
    echo "-> Downloading Void Linux Base..."
    wget -q "$URL$LATEST_TAR" -O rootfs.tar.xz
    
    mkdir -p rootfs
    echo "-> Extracting rootfs (this might take a moment)..."
    tar -xpf rootfs.tar.xz -C rootfs
    cp /workspace/randy-setup.sh rootfs/tmp/
    
    mount -t proc /proc rootfs/proc
    mount --rbind /sys rootfs/sys
    mount --rbind /dev rootfs/dev
    cp /etc/resolv.conf rootfs/etc/
    
    echo "-> Installing Randy dependencies inside the rootfs..."
    chroot rootfs /bin/sh /tmp/randy-setup.sh
    
    umount -l rootfs/dev rootfs/sys rootfs/proc
    
    echo "-> Packaging the final OS payload to workspace..."
    cd rootfs
    tar -cz . > /workspace/randy-os-intel.tar.gz
'

echo "######>>> DONE!"