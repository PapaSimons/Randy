#!/bin/sh
set -e

echo "######>>> Downloading official Alpine deployment tool..."
curl -sLO https://raw.githubusercontent.com/alpinelinux/alpine-chroot-install/v0.14.0/alpine-chroot-install
chmod +x alpine-chroot-install

echo "######>>> Creating target directory for pristine OS..."
mkdir -p /target-rootfs

echo "######>>> Building minimal OS environment in the cloud..."
# FIX: Give the script just the base mirror domain; it will append /v3.19/main natively
./alpine-chroot-install \
  -d /target-rootfs \
  -b v3.19 \
  -m http://dl-cdn.alpinelinux.org/alpine \
  -p "linux-firmware nodejs npm gcompat alsa-utils mpv yt-dlp curl tar wpa_supplicant avahi openssh eudev sudo"

echo "######>>> Configuring internal OS architecture..."
# Reach inside the generated rootfs and cleanly configure everything
chroot /target-rootfs /bin/sh -c '
  echo "http://dl-cdn.alpinelinux.org/alpine/v3.19/main" > /etc/apk/repositories
  echo "http://dl-cdn.alpinelinux.org/alpine/v3.19/community" >> /etc/apk/repositories

  echo "-> Setting up users..."
  adduser -D -s /bin/sh randy
  echo "randy:randy" | chpasswd
  adduser randy audio
  adduser randy wheel
  echo "%wheel ALL=(ALL) ALL" > /etc/sudoers.d/wheel

  echo "-> Configuring bit-perfect ALSA audio floor..."
  cat <<AUDIO > /etc/asound.conf
defaults.pcm.card 1
defaults.ctl.card 1
pcm.!default {
    type plug
    slave.pcm hw
}
AUDIO

  echo "-> Enabling boot services..."
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

  echo "-> Deploying Randy Node.js Application..."
  LOC=$(curl -s https://api.github.com/repos/papasimons/Randy/releases/latest | grep "tag_name" | awk "{print \"https://github.com/papasimons/Randy/archive/\" substr(\$2, 2, length(\$2)-3) \".tar.gz\"}")
  curl -s -L -o /tmp/randy.tar.gz "$LOC"
  mkdir -p /opt/Randy
  tar xzf /tmp/randy.tar.gz --strip 1 -C /opt/Randy
  cd /opt/Randy && npm install --no-audit --no-fund
  chown -R randy:randy /opt/Randy

  echo "-> Creating Background Service Daemon..."
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

echo "######>>> Compressing final master image..."
cd /target-rootfs
tar -czf /workspace/randy-rootfs.tar.gz *

echo "######>>> Phase 1 Build Complete!"