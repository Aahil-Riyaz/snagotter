# ytdown: research notes (Phase 1)

Checked 2026-11-22. yt-dlp changes every month, so check these again before each release.

## 1. Engine versions today

| Thing | Current | Notes |
|---|---|---|
| yt-dlp (stable, PyPI) | **2026.10.26** | Nightly builds dated Nov 4–20 exist on PyPI as `--pre` dev releases. |
| yt-dlp-ejs | **0.8.0** | Each yt-dlp version pins one exact ejs version and rejects the rest. Install with `pip install "yt-dlp[default]"` so pip resolves the right pin. Never pin ejs on its own. |
| JS runtime for YouTube | Deno ≥ 2.3.0 **or** Node ≥ 22 (QuickJS also works) | 2026.10.26 raised the minimums and deprecated Bun. |
| ffmpeg / ffprobe | any recent static build (7.x) | Needed for merging, audio conversion, thumbnail embedding and trimming. |

### Decision: default to Node and keep Deno optional
The brief recommends Deno. In October 2026 the Deno team announced it was joining Cloudflare. Reports say Deno Deploy shuts down after about six months, and the future of the standalone runtime is unclear. I couldn't find a primary source that confirms a runtime end date. yt-dlp accepts Node ≥ 22 just as well, Node is already on most dev machines (v24 on this one), and Node is also what Vercel and most Docker images ship. So:
- The Doctor looks for **Node ≥ 22 first, then Deno ≥ 2.3**. Either one passes.
- yt-dlp is configured with `js_runtimes={"node": {}, "deno": {}}` so it uses whichever it finds.
- Docker bundles Node, so there's no Deno dependency to break later.

## 2. Platform status and known breakages

- **YouTube.** You need the JS runtime and ejs, or many formats disappear and you get only low resolutions. The "Sign in to confirm you're not a bot" block is mostly based on **IP reputation**: datacenter IPs (AWS, which includes Vercel, GCP and similar) get it all the time, and residential IPs rarely do. PO tokens are now bound to each video. The PO Token Guide recommends a provider plugin (e.g. `bgutil-ytdlp-pot-provider`) and advises against manual tokens. A short format list with only low resolutions means a token problem, not a bot check. In August 2026 a default client began returning 403s and was removed in 2026.08.19, so updating fixes most "403" reports.
- **Instagram.** The extractor was reworked in 2026 (logged-in extraction fix #17278, invalid-cookie detection). Logged-out access is unreliable and heavily rate-limited, especially from datacenter IPs. Cookies (the user's own) are the supported fix.
- **TikTok.** Challenge-solving fix (#16223, Mar 2026), plus extractor and format fixes in August master builds (#17452, #17460). Short links (`vm.`/`vt.`) redirect and yt-dlp resolves them. Format IDs that include `download` / `watermark` in the note need labels: prefer play formats with no watermark note.
- **X / Twitter.** view_count fix (#16814), broadcast events fix (#17323), and share-URL support (#17459, August master). GIFs come through as MP4 with no audio stream. Posts with several videos come back as a playlist with entries.
- **Security.** CVE-2026-50574 allows arbitrary code execution through manifest downloads **when aria2c is the external downloader**. ytdown never enables aria2c and uses the native downloader only.

Takeaway: ship with a one-click switch between **stable and nightly**. When an extractor breaks, the fix usually lands in nightly within days.

## 3. Python API we'll use (no shell strings)

```python
from yt_dlp import YoutubeDL
from yt_dlp.utils import download_range_func

opts = {
    "quiet": True, "no_warnings": True, "noprogress": True,
    "noplaylist": True,                 # flipped when the user picks "whole playlist"
    "extract_flat": "in_playlist",      # fast first look at playlists/channels
    "js_runtimes": {"node": {}, "deno": {}},
    "paths": {"home": job_dir, "temp": job_dir},
    "outtmpl": "%(id)s.%(ext)s",        # we rename to the pretty name ourselves
    "progress_hooks": [on_progress],
    "postprocessor_hooks": [on_post],
    "merge_output_format": "mp4",       # or mkv/webm depending on codecs
    "concurrent_fragment_downloads": 4,
}
with YoutubeDL(opts) as ydl:
    info = ydl.sanitize_info(ydl.extract_info(url, download=False))
```

- Cancel: raise `yt_dlp.utils.DownloadCancelled` from inside the progress hook when the job's cancel flag is set, then `rmtree(job_dir)`.
- Trim: `"download_ranges": download_range_func(None, [(start, end)])`, so the cut stays a remux (no forced keyframes).
- Cookies: `"cookiefile": path` (an uploaded cookies.txt, kept in the job temp dir and wiped afterwards) or `"cookiesfrombrowser": ("chrome",)`.
- Error mapping uses `DownloadError` / `ExtractorError` messages. The known substrings are listed in §5.

## 4. Format selector syntax we'll generate

We never pass free text from the client. The client sends `{mode, format_id, convert?}` and the server builds the selector:

| Mode | Selector the server builds |
|---|---|
| Video + audio, row picked | `{vid}+{aud}` where `aud` is the best audio that fits the container (m4a for an mp4/H.264 video, opus/webm otherwise), falling back to `{vid}+ba/b` |
| Video + audio, "Plays everywhere" | `bv*[vcodec^=avc1]+ba[acodec^=mp4a]/b[ext=mp4]` with `merge_output_format=mp4` |
| Video + audio, best overall | `bv*+ba/b` |
| Video only | `{vid}` (a video-only stream), or `bv*[acodec=none]` for the best one |
| Audio, original | `ba/b` with no postprocessor, so the extension stays the source's |
| Audio, convert | `ba/b` + `FFmpegExtractAudio{preferredcodec, preferredquality}` |

Sort key for the video table: `(height, fps, is_hdr, tbr)` descending. Group by `(height, fps, hdr)` with codec variants nested inside.

Size: use `filesize`, then `filesize_approx` (shown with ≈), then `tbr * duration * 125` (≈). If none of those exist, show "size unknown". Never make one up.

Labels: 2160 → "4K", 1440 → "2K". HDR when `dynamic_range` ∉ {SDR, None}.

## 5. Error strings → states

| Substring in the yt-dlp message (case-insensitive) | State |
|---|---|
| `private video`, `video unavailable`, `has been removed`, `does not exist`, `404` | unavailable |
| `sign in to confirm your age`, `age-restricted`, `login required`, `requires authentication` | login_required |
| `not available in your country`, `geo restrict` | region_locked |
| `is live`, `live event will begin`, `premieres in` | live_in_progress |
| `unsupported url`, `no video formats found`, `there is no video in this post` | unsupported |
| `confirm you're not a bot`, `http error 429`, `rate-limit` | rate_limited |
| `unable to download webpage`, `timed out`, `connection reset`, `getaddrinfo` | network |
| `ffmpeg not found`, `ffprobe`, `javascript runtime` | dependency_missing |
| anything else after the engine is >14 days old | engine_outdated, otherwise generic |

## 6. Hosting on Vercel: what actually works

Vercel Python functions (Fluid compute): 500 MB bundle limit (larger is a beta), 300 s default duration, 800 s max on Pro and 300 s on Hobby, streaming responses supported. They're stateless: instances don't share memory or disk.

What this means for ytdown:
1. **The frontend (PWA) is a perfect fit for Vercel.** It's static, fast and free.
2. **The download engine is a poor fit for Vercel:**
   - Vercel runs on AWS IPs, so YouTube and Instagram send "not a bot" / login walls on many requests. That's the exact failure the brief warns about.
   - Jobs, SSE progress and `/file` would land on different instances, so the job model in the brief can't work as written.
   - Merging 1080p+ with ffmpeg and long videos hit the 300 s limit on Hobby.
   - Streaming large files through Vercel uses up the bandwidth allowance quickly.
3. **Recommended split.** The **PWA is hosted on Vercel**, and it talks to the **ytdown engine running on the user's own machine** (`127.0.0.1:8787`, started with one command, later by the Tauri app). When no engine is found, the hosted page shows a calm "Connect your engine" screen with one-line install commands. A self-hosted Docker engine on any server can be pointed to from settings.
   - Browser note: Chrome asks permission (Local Network Access) before a public HTTPS page can reach `127.0.0.1`. The engine answers the preflight with `Access-Control-Allow-Private-Network: true` and allows the Vercel origin in CORS. Safari blocks HTTPS→HTTP localhost, so the engine also serves the same PWA itself at `http://127.0.0.1:8787`. That's the fallback that always works.
4. Optional later: a "lite" Vercel function for TikTok/X info only. It's not in v1, because it would fail unpredictably.

## Sources
- yt-dlp releases: https://github.com/yt-dlp/yt-dlp/releases
- yt-dlp 2026.10.21 release: https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.21
- yt-dlp on PyPI: https://pypi.org/project/yt-dlp/
- External JS runtime announcement (#15012): https://github.com/yt-dlp/yt-dlp/issues/15012
- PO Token Guide: https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide
- Deno joining Cloudflare (secondary coverage): https://www.socket.dev/blog/deno-acquisition
- Vercel function limits: https://vercel.com/docs/functions/limitations
- Vercel Python runtime: https://vercel.com/docs/functions/runtimes/python
- Vercel Python bundle 500 MB: https://vercel.com/changelog/python-vercel-functions-bundle-size-limit-increased-to-500mb
