# Cloudflare WARP (free) as a SOCKS5 proxy for ytdown, from Cloudflare's official package.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl gnupg ca-certificates socat \
 && curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ bookworm main" > /etc/apt/sources.list.d/cloudflare-client.list \
 && apt-get update && apt-get install -y --no-install-recommends cloudflare-warp \
 && rm -rf /var/lib/apt/lists/*
COPY entrypoint.sh /entrypoint.sh
EXPOSE 1080
HEALTHCHECK --interval=60s --timeout=10s --start-period=60s \
  CMD curl -fsS --max-time 8 -x socks5h://127.0.0.1:1080 https://www.cloudflare.com/cdn-cgi/trace | grep -q "warp=on"
ENTRYPOINT ["sh", "/entrypoint.sh"]
