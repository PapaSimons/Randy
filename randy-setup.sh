#!/sbin/openrc-run

description="Randy OS First-Boot Wi-Fi Setup Wizard"

start() {
    if [ -f /etc/randy-setup-done ]; then
        return 0
    fi

    exec > /dev/tty1 2>&1
    clear
    echo "======================================================="
    echo "            Welcome to your new Randy OS Node!         "
    echo "======================================================="
    echo ""
    echo "Let's connect your device to your home local network."
    echo ""

    WIFI_IF=$(ls /sys/class/net | grep -E '^wl|^wlan' | head -n 1)
    if [ -z "$WIFI_IF" ]; then
        echo "ERROR: No internal Wi-Fi adapter detected by the kernel."
        echo "Please connect an Ethernet cable instead."
        touch /etc/randy-setup-done
        return 1
    fi

    echo "Found Wi-Fi Interface: $WIFI_IF"
    read -p "Enter your Wi-Fi Network Name (SSID): " wifi_ssid
    read -p "Enter your Wi-Fi Password: " wifi_pass
    echo ""

    echo "-> Writing secure network configuration..."
    mkdir -p /etc/wpa_supplicant
    cat << 'EOF' > /etc/wpa_supplicant/wpa_supplicant.conf
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=wheel
update_config=1
network={
    ssid="$wifi_ssid"
    psk="$wifi_pass"
}
EOF

    echo "-> Initializing network interfaces..."
    rc-service wpa_supplicant restart >/dev/null 2>&1
    rc-service networking restart >/dev/null 2>&1
    
    echo "nameserver 1.1.1.1" > /etc/resolv.conf
    sleep 4

    echo "-> Verifying network handshake..."
    if ping -c 1 dl-cdn.alpinelinux.org >/dev/null 2>&1; then
        LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}')
        echo ""
        echo "======================================================="
        echo " SUCCESS! Your node is online."
        echo "======================================================="
        echo " Local Network IP Address: $LOCAL_IP"
        echo " SSH Access Command:       ssh randy@$LOCAL_IP"
        echo "======================================================="
        echo ""
        touch /etc/randy-setup-done
        read -p "Press ENTER to launch the Randy Node Engine..."
    else
        echo "ERROR: Connection timed out. Check your credentials and reboot to retry."
        echo "Falling back to local shell..."
        sleep 5
    fi
}