#!/bin/sh
# Sites change often, so a long-running server pulls the newest yt-dlp every time it starts.
# YTDOWN_AUTOUPDATE: "nightly" (default on servers), "stable", or "off".
set -e
case "${YTDOWN_AUTOUPDATE:-off}" in
  nightly) pre="--pre" ;;
  stable)  pre="" ;;
  *)       exec "$@" ;;
esac
echo "Updating yt-dlp (${YTDOWN_AUTOUPDATE})..."
timeout 180 pip install --no-cache-dir -q -U $pre "yt-dlp[default]" || echo "yt-dlp update failed; starting with the installed version."
python -c "import yt_dlp; print('yt-dlp', yt_dlp.version.__version__)"
exec "$@"
