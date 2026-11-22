# ytdown

Paste a link, see the media, pick exactly the format you want, download it. YouTube, Instagram, TikTok, X and most other sites [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports. No accounts, no ads, no tracking.

ytdown is **local-first**. The download engine runs on your own computer, so sites see a normal home connection, and your links and files never pass through anyone else's server. The app is an installable web app (PWA). You can use it straight from the engine, or host it on Vercel and point it at your engine.

Made by Aahil Riyaz Beekay. Only download content you have the right to use.

More docs: [design system](DESIGN.md) · [research notes](docs/research.md) · [integration test log](docs/test-log.md) · [screenshots](docs/screens/)

---

## Start it (one command)

You need **Python 3.12+**, **Node 22+** (to build the app once, and as the JavaScript runtime YouTube needs) and **ffmpeg**.

**Windows (PowerShell)**
```powershell
winget install Python.Python.3.13 OpenJS.NodeJS.LTS Gyan.FFmpeg
.\start.ps1
```

**macOS**
```sh
brew install python node ffmpeg
./start.sh
```

**Linux (Debian/Ubuntu)**
```sh
sudo apt install python3 python3-venv nodejs npm ffmpeg   # Node must be 22+: https://nodejs.org
./start.sh
```

The first run creates `engine/.venv`, installs the engine and builds the app. After that, it starts the engine on **http://127.0.0.1:8787** and opens it in your browser. Install it from the browser's address bar ("Install app") to get a desktop or phone app with a share target: share a link from another app straight into ytdown.

**Docker:**
```sh
docker compose up -d        # then open http://127.0.0.1:8787
```
The image bundles Python 3.12, ffmpeg and Node 22. Reading cookies from a browser doesn't work inside Docker; upload a cookies.txt instead.

**Developing:** `make dev` runs the engine with auto-reload on :8787 and Vite on :5173 (it proxies `/api`). `make test` runs the unit tests and the typecheck.

---

## Host the app on Vercel

Only the **app** goes on Vercel. The **engine** keeps running on your computer.

The engine can't run on Vercel itself, for three reasons:
- Vercel runs on AWS addresses, and YouTube and Instagram answer those with "Sign in to confirm you're not a bot".
- Vercel's functions stop after a few minutes.
- Live progress needs a long-running process.

[docs/research.md §6](docs/research.md) has the details.

1. Push this folder to GitHub and import it in Vercel.
2. Set **Root Directory** to `web`. Vercel reads `web/vercel.json`, which handles the build, the PWA files and the headers.
3. Optional environment variables:
   - `VITE_ENGINE_URL`: where the app looks for the engine (default `http://127.0.0.1:8787`).
   - `VITE_REPO_URL`: shows a GitHub link in the footer.
4. Allow your Vercel address on the engine. `https://ytdown.vercel.app` is allowed out of the box. For any other address, start the engine with:
   ```powershell
   $env:YTDOWN_ORIGINS = "https://your-app.vercel.app,http://127.0.0.1:8787,http://localhost:8787"; .\start.ps1
   ```
   ```sh
   YTDOWN_ORIGINS="https://your-app.vercel.app,http://127.0.0.1:8787,http://localhost:8787" ./start.sh
   ```
5. Open your Vercel URL. Chrome asks once to let the page reach your computer (Local Network Access), so allow it. If no engine answers, the page shows how to start one.

**Safari** doesn't let websites reach your own computer. On a Mac with Safari, use the app at http://127.0.0.1:8787 (it's the same app).

**Phones:** run the engine on a computer on the same Wi-Fi with `--host 0.0.0.0 --mode hosted`, then open `http://<computer-ip>:8787` on the phone and install it from there. Hosted mode adds per-IP rate limits and size and length caps, and turns off cookies and engine updates.

---

## What it does

- **Three modes:** Video + audio, Video only, Audio only.
- **A spec-sheet format table:** best to worst by resolution, fps, HDR and bitrate. Codec variants (AV1 / VP9 / H.264) are nested in each row, and sizes are real, or marked ≈ when estimated from bitrate.
- **Plays everywhere:** H.264 + AAC in an MP4 that plays on any phone, TV or editor. Turn it off for the true best quality (AV1 or VP9 with Opus, in WebM).
- **Audio:** the original track with no re-encoding, or MP3 320/192/128, M4A, Opus, FLAC or WAV. It tells you honestly when converting adds size, not quality. Title, artist and cover art are embedded.
- **More options:** subtitles (embedded or .srt), thumbnail, trim a section, GIF for short clips, and a filename preview.
- **Playlists, carousels and multi-video posts:** pick the items you want. Paste several links to queue them, with three downloads at a time.
- **Real progress over SSE.** Cancel deletes partial files. Temporary files are removed after delivery or after an hour.
- **Keyboard:** Ctrl/⌘+V anywhere pastes and fetches, Enter fetches, ↑/↓ choose a format, ←/→ switch codec, D downloads, / focuses the link box.
- **Plain errors:** each one says what happened and what to do next, with one action button and the raw details behind "Details".

## Troubleshooting

**A site stopped working, or "The download engine is out of date."**
Sites change often. Use the banner's **Update engine** button, or Settings → **Nightly** → Update (fixes reach nightly days before stable). The engine restarts by itself. By hand:
```powershell
engine\.venv\Scripts\python -m pip install -U --pre "yt-dlp[default]"
```
```sh
engine/.venv/bin/python -m pip install -U --pre "yt-dlp[default]"
```

**"ffmpeg isn't installed."** Use `winget install Gyan.FFmpeg`, `brew install ffmpeg` or `sudo apt install ffmpeg`, then restart ytdown. The engine also finds ffmpeg in winget's folders, or wherever `YTDOWN_FFMPEG_DIR` points.

**"No JavaScript runtime found" or YouTube shows only low qualities.** Install Node 22+ (`winget install OpenJS.NodeJS.LTS`, `brew install node`). Deno 2.3+ works too. Keep `yt-dlp[default]` installed, since it brings the matching `yt-dlp-ejs`.

**"The site is asking to confirm you're not a bot" or "needs you to be signed in."** Wait a few minutes, or press **Use my cookies**. Pick the browser you're signed in with, or upload a cookies.txt. Cookies stay in the engine's memory on your computer and are only sent to that site. On Windows, Chrome and Edge lock and encrypt their cookies, so Firefox or a cookies.txt works best.

**Instagram says it needs a login.** Instagram limits logged-out access heavily. Use your own cookies as described above.

**The hosted page says "Start the engine" while the engine is running.** Check that its address is allowed (`YTDOWN_ORIGINS`), that you allowed Chrome's local-network prompt, and that you're not in Safari.

**Port 8787 is busy.** Start with `.\start.ps1 --port 8788` or `./start.sh --port 8788`. If you use the hosted app, update Settings → Engine address too.

## Layout

```
engine/          FastAPI + yt-dlp engine (Python). Run: python -m ytdown_engine
  ytdown_engine/ urls.py (normalise, SSRF guard), formats.py (format table, selectors),
                 jobs.py (queue, progress, cancel, cleanup), errors.py, names.py, doctor.py, app.py
  tests/         unit tests (pytest)
  scripts/       probe.py: live end-to-end check verified with ffprobe
web/             Vite + React + TypeScript PWA; tokens in src/styles/tokens.css
docs/            research.md, test-log.md, screens/ (real screenshots)
DESIGN.md        design tokens and rules
mockups/         the approved static mockups
```

## API

| Endpoint | What it does |
|---|---|
| `POST /api/info {url}` | media info: formats grouped and sorted, audio tracks, subtitles; or playlist/carousel entries |
| `POST /api/jobs {url, mode, format_id, audio_id, compat, convert, options, items}` | start a download → `{job_id}` |
| `GET /api/jobs/{id}/events` | Server-Sent Events, about 4 updates a second |
| `GET /api/jobs/{id}/file` | the file (RFC 5987 UTF-8 filename) |
| `DELETE /api/jobs/{id}` | cancel and clean up |
| `GET /api/doctor` | ffmpeg, ffprobe, JS runtime, engine version and age |
| `POST /api/engine/update {channel}` | local mode only: update yt-dlp and restart |

**Security:** in local mode the engine listens on 127.0.0.1 only and rejects other Host headers (DNS rebinding). Writes need an allowed Origin. Every link is checked to be http(s), and in hosted mode the host must resolve to a public address. Client-sent paths and filenames are never trusted. Cookies are never logged.
