# ytdown engine + PWA in one image: Python 3.12, ffmpeg, Node 22 (JS runtime for YouTube).
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
ARG VITE_ENGINE_URL=""
ARG VITE_REPO_URL=""
RUN npm run build

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    YTDOWN_IN_DOCKER=1 YTDOWN_HOST=0.0.0.0 YTDOWN_PORT=8787 YTDOWN_TEMP=/tmp/ytdown \
    YTDOWN_WEB_DIST=/app/web/dist PATH=/opt/venv/bin:$PATH
# ffmpeg for merging/converting; node (>=22) runs YouTube's JS challenges via yt-dlp-ejs
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 ytdown \
    && python -m venv /opt/venv && mkdir -p /tmp/ytdown \
    && chown -R ytdown:ytdown /opt/venv /tmp/ytdown
WORKDIR /app/engine
COPY engine/requirements.txt .
USER ytdown
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=ytdown:ytdown engine/ytdown_engine ./ytdown_engine
COPY --chown=ytdown:ytdown deploy/entrypoint.sh /app/entrypoint.sh
COPY --from=web /web/dist /app/web/dist
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/api/settings')"
ENTRYPOINT ["sh", "/app/entrypoint.sh"]
CMD ["python", "-m", "ytdown_engine"]
