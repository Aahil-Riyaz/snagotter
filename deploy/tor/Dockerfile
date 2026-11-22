# Tor (Debian's official package) as a SOCKS5 proxy for sites that refuse the server's country.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tor tor-geoipdb curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY torrc /etc/tor/torrc
EXPOSE 9050
HEALTHCHECK --interval=120s --timeout=30s --start-period=120s \
  CMD curl -fsS --max-time 25 -x socks5h://127.0.0.1:9050 https://check.torproject.org/api/ip | grep -q '"IsTor":true'
USER debian-tor
CMD ["tor", "-f", "/etc/tor/torrc"]
