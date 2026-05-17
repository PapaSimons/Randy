#!/bin/sh
set -e

echo "######>>> Setting up deployment wizard environment..."
mkdir -p overlay/etc/local.d
mkdir -p overlay/etc/runlevels/default

# Create the automated engine script that runs the split second the RAM environment boots
cat << 'EOF' > overlay/etc/local.d/randy-deploy.start
#!/bin/sh
exec > /dev/tty1 2>&1
sleep 2
clear

echo "======================================================="
echo "       Randy OS Live Ramdisk Deployment Engine         "
echo "======================================================="
echo ""
echo "-> RAM environment successfully initialized."
echo "-> Storage controller drivers online."
echo ""
echo "STANDBY: Ready for deployment Phase 3."
echo "======================================================="
EOF
chmod +x overlay/etc/local.d/randy-deploy.start
ln -s /etc/init.d/local overlay/etc/runlevels/default/local

echo "######>>> Packaging the apkovl..."
cd overlay && tar -czf ../localhost.apkovl.tar.gz * && cd ..
rm -rf overlay

echo "######>>> Cloning Stable Alpine Aports for native ramdisk compiler..."
git config --global user.name "Randy Builder"
git config --global user.email "build@randyos.com"

# THE FIX: Explicitly clone the stable 3.19 branch instead of the cutting-edge master branch
git clone --branch 3.19-stable --depth=1 https://github.com/alpinelinux/aports.git

echo "######>>> Creating Custom Deployment Profile..."
cat << 'EOF' > aports/scripts/mkimg.randydeploy.sh
profile_randydeploy() {
    profile_standard
    title="Randy Deployer"
    desc="RAM-based Deployment Engine"
    profile_abuild="randy"
    # Crucial: Bake hard drive, partition, and archive tools directly into the RAM boot filesystem
    initfs_features="ata base cdrom ext2 ext3 ext4 scsi usb virtio"
    apks="$apks util-linux e2fsprogs dosfstools grub-efi tar"
}
EOF

echo "######>>> Setting up isolated builder user..."
adduser -D -G abuild builder
chown -R builder:abuild /workspace

echo "######>>> Compiling Ramdisk ISO..."
su builder -c "abuild-keygen -n"
cp /home/builder/.abuild/*.rsa.pub /etc/apk/keys/
echo "PACKAGER_PRIVKEY=\"$(ls /home/builder/.abuild/*.rsa | head -n 1)\"" >> /etc/abuild.conf

cd aports/scripts
# Cleaned up the unsupported flag; the versions match perfectly now!
su builder -c "sh mkimage.sh \
  --tag v3.19 \
  --outdir ../../ \
  --arch x86_64 \
  --repository http://dl-cdn.alpinelinux.org/alpine/v3.19/main \
  --profile randydeploy"

cd ../../
echo "######>>> Injecting deployment assets onto media..."
xorriso -indev alpine-randydeploy-v3.19-x86_64.iso \
        -outdev randy-os-installer.iso \
        -map localhost.apkovl.tar.gz /localhost.apkovl.tar.gz \
        -map randy-rootfs.tar.gz /randy-rootfs.tar.gz \
        -boot_image any replay >/dev/null 2>&1

chmod 777 randy-os-installer.iso
echo "######>>> Phase 2 Build Complete!"