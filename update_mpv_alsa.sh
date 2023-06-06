echo "######>>> prevent Ubuntu server popups"

apt-get remove -y needrestart


echo "-------------------------------------------"
echo "######>>> installing mpv"
echo "-------------------------------------------"

curl https://non-gnu.uvt.nl/debian/uvt_key.gpg --output uvt_key.gpg
mv uvt_key.gpg /etc/apt/trusted.gpg.d
apt-get install -y apt-transport-https
sudo sh -c 'echo "deb https://non-gnu.uvt.nl/debian $(lsb_release -sc) uvt" >> /etc/apt/sources.list.d/non-gnu-uvt.list'
apt-get -y update
apt-get install -y -t "o=UvT" mpv

#apt-get install -y mpv

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