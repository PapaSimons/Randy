echo "-------------------------------------------"
echo "######>>> stopping randy service"
echo "-------------------------------------------"

systemctl stop randy-node

echo "-------------------------------------------"
echo "######>>> deleting randy files"
echo "-------------------------------------------"

echo "backing up DB files"
cp -R Randy/DB DB_bk
echo "removing existing files"
rm -R Randy
rm -R node_modules
rm -R package*
rm randy_release.tar.gz

echo "-------------------------------------------"
echo "######>>> Download latest release of Randy"
echo "-------------------------------------------"

LOCATION=$(curl -s https://api.github.com/repos/papasimons/Randy/releases/latest \
| grep "tag_name" \
| awk '{print "https://github.com/papasimons/Randy/archive/" substr($2, 2, length($2)-3) ".tar.gz"}') \
; curl -L -o randy_release.tar.gz $LOCATION

mkdir Randy
tar xvfz randy_release.tar.gz --strip 1 -C Randy

echo "putting DB files back"
cp -R DB_bk/* Randy/DB
rm -R DB_bk

echo "-------------------------------------------"
echo "######>>> installing Randy Dependencies"
echo "-------------------------------------------" 

npm install ./Randy

echo "-------------------------------------------"
echo "######>>> starting randy service"
echo "-------------------------------------------"

systemctl start randy-node