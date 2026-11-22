#!/bin/sh
# Start WARP in proxy mode (no VPN, no extra privileges) and expose it to the Docker network.
set -e
mkdir -p /run/dbus
warp-svc --accept-tos >/var/log/warp-svc.log 2>&1 &
i=0; until warp-cli --accept-tos status >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 30 ] && { cat /var/log/warp-svc.log; exit 1; }; sleep 1; done
warp-cli --accept-tos registration show >/dev/null 2>&1 || warp-cli --accept-tos registration new
warp-cli --accept-tos mode proxy
warp-cli --accept-tos proxy port 40000
warp-cli --accept-tos connect
i=0; until warp-cli --accept-tos status | grep -q Connected; do i=$((i+1)); [ $i -gt 90 ] && { warp-cli --accept-tos status; exit 1; }; sleep 1; done
echo "WARP connected; SOCKS5 on :1080"
exec socat TCP-LISTEN:1080,fork,reuseaddr TCP:127.0.0.1:40000
