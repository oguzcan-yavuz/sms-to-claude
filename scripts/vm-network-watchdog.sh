#!/bin/bash
# Watchdog: detects when the bridged network interface drops and resets it.
# Runs every minute via cron. Logs to /tmp/vm-network-watchdog.log.

INTERFACE=enp0s1
GATEWAY=192.168.1.1

if ping -c 2 -W 3 "$GATEWAY" &>/dev/null; then
  exit 0
fi

echo "[$(date -Iseconds)] Gateway unreachable — resetting $INTERFACE"
ip link set "$INTERFACE" down
sleep 2
ip link set "$INTERFACE" up
systemctl restart systemd-networkd
echo "[$(date -Iseconds)] Interface reset done"
