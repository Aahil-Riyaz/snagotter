#!/bin/sh
# Install or update ytdown on a server that already runs Caddy in Docker (for example next to n8n).
#   YTDOWN_DOMAIN=ytdown.example.org CADDY_DIR=~/n8n sh deploy/install.sh
# Adds a site block to $CADDY_DIR/Caddyfile once, builds and starts ytdown, reloads Caddy
# without restarting it, and adds a daily job that pulls the repo and restarts ytdown
# (which also updates yt-dlp).
set -eu
: "${YTDOWN_DOMAIN:?set YTDOWN_DOMAIN}"
CADDY_DIR="${CADDY_DIR:-$HOME/n8n}"
CADDY_CONTAINER="${CADDY_CONTAINER:-n8n-caddy-1}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export YTDOWN_DOMAIN

printf 'YTDOWN_DOMAIN=%s\n' "$YTDOWN_DOMAIN" > "$REPO_DIR/deploy/.env"
sudo docker compose -f "$REPO_DIR/deploy/compose.yml" --env-file "$REPO_DIR/deploy/.env" up -d --build

if ! grep -q "^$YTDOWN_DOMAIN " "$CADDY_DIR/Caddyfile"; then
  cp "$CADDY_DIR/Caddyfile" "$CADDY_DIR/Caddyfile.bak-$(date +%Y%m%d%H%M%S)"
  cat >> "$CADDY_DIR/Caddyfile" <<EOF

$YTDOWN_DOMAIN {
    reverse_proxy ytdown:8787 {
        flush_interval -1
    }
}
EOF
fi
sudo docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

CRON="17 4 * * * cd $REPO_DIR && git pull -q && YTDOWN_DOMAIN=$YTDOWN_DOMAIN sudo docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build && sudo docker restart ytdown >/dev/null"
( crontab -l 2>/dev/null | grep -v 'deploy/compose.yml' ; echo "$CRON" ) | crontab -
echo "ytdown is starting at https://$YTDOWN_DOMAIN"
