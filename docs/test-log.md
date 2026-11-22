# ytdown: integration test log (Phase 5)

**Run date:** 2026-11-22, Windows 11, home connection.
**Engine:** yt-dlp `2026.11.20.232656` (nightly, installed with the app's own *Update engine → Nightly* flow), yt-dlp-ejs 0.8.0, Node 24.13, ffmpeg 9.1.

**How:** `engine/scripts/probe.py` drives the live API the same way the UI does (`POST /api/info` → `POST /api/jobs` → SSE `/events` → `GET /file`). It then checks the downloaded file with **ffprobe**: the expected video and audio streams are present or absent, and the duration matches the source within 2% (or 2 s). Three jobs ran at once, to exercise the queue.

The test links come from yt-dlp's own extractor test suites (public posts its maintainers chose for testing), plus Blender's CC-licensed videos. "best" means the top row with Plays everywhere **off** (true best). "lower" means the third row down.

## Results: 26 pass, 2 behave as designed, 0 failures

| # | Site | Kind | Mode | Output file | Video | Audio | Height | Duration (file / source, s) | Time (s) | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | youtube | single | best | Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film (4K).webm | av1 | opus | 2160 | 634.6 / 635 | 103.9 | pass |
| 2 | youtube | Short | best | MET THE LOVE OF MY LIFE ON AN AIRPLANE caught on camera — Allie Schnacky (720p).webm | av1 | opus | 1280 | 14.4 / 14 | 11.5 | pass |
| 3 | youtube | Short | lower | … — Allie Schnacky (480p).webm | av1 | opus | 854 | 14.4 / 14 | 10.3 | pass |
| 4 | youtube | Short | video | … — Allie Schnacky (720p, no audio).mp4 | av1 | – | 1280 | 14.3 / 14 | 11.5 | pass |
| 5 | youtube | Short | audio | … — Allie Schnacky.opus | – | opus | – | 14.4 / 14 | 10.8 | pass |
| 6 | youtube | Short | mp3 | … — Allie Schnacky.mp3 | – | mp3 | – | 14.3 / 14 | 14.1 | pass |
| 7 | youtube | playlist item 1 | best | First Steps - Blender 2.80 Fundamentals (1080p).webm | av1 | opus | 1080 | 58.5 / 59 | 9.2 | pass |
| 8 | youtube | playlist item 2 | mp3 | Viewport Navigation - Blender 2.80 Fundamentals.mp3 | – | mp3 | – | 221.8 / 222 | 14.1 | pass (2nd run, see fix 7) |
| 9 | instagram | Reel (silent) | best | Video by instagram (720p).mp4 | h264 | – | 1280 | 5.0 / n/a | 9.0 | pass |
| 10 | instagram | Reel | lower | Video by clippedinandfree — Alina Jäger (322p).mp4 | h264 | aac | 572 | 13.5 / n/a | 5.9 | pass |
| 11 | instagram | Reel (silent) | video | Video by instagram (720p, no audio).mp4 | h264 | – | 1280 | 5.0 / n/a | 7.0 | pass |
| 12 | instagram | Reel | audio | Video by clippedinandfree — Alina Jäger.m4a | – | aac | – | 13.5 / n/a | 8.0 | pass |
| 13 | instagram | Reel | mp3 | Video by clippedinandfree — Alina Jäger.mp3 | – | mp3 | – | 13.5 / n/a | 9.7 | pass |
| 14 | instagram | carousel item 1 | best | Video by instagram (640p).mp4 | h264 | – | 640 | 4.0 / n/a | 10.8 | pass |
| 15 | instagram | carousel item 2 (silent) | audio | error `no_audio` | – | – | – | – | 12.0 | as designed |
| 16 | tiktok | video | best | TikTok video #7047596209028074758 — hankgreen1 (576p).mp4 | hevc | aac | 1024 | 21.3 / 21 | 5.1 | pass |
| 17 | tiktok | video | lower | … — hankgreen1 (576p).mp4 | h264 | aac | 1024 | 21.3 / 21 | 4.3 | pass |
| 18 | tiktok | video | video | … — hankgreen1 (576p, no audio).mp4 | hevc | – | 1024 | 21.3 / 21 | 3.4 | pass |
| 19 | tiktok | video | audio | … — hankgreen1.mp3 (TikTok's original track is MP3) | – | mp3 | – | 21.1 / 21 | 4.9 | pass |
| 20 | tiktok | video | mp3 | … — hankgreen1.mp3 | – | mp3 | – | 21.1 / 21 | 5.7 | pass |
| 21 | x | video | best | Brooklyn Nets - WATCH Sean Marks' full media session… (720p).mp4 | h264 | aac | 720 | 324.5 / 324.5 | 23.1 | pass |
| 22 | x | video | lower | … (270p).mp4 | h264 | aac | 270 | 324.5 / 324.5 | 6.7 | pass |
| 23 | x | video | video | … (720p, no audio).mp4 | h264 | – | 720 | 324.5 / 324.5 | 10.6 | pass |
| 24 | x | video | audio | ….m4a | – | aac | – | 324.5 / 324.5 | 9.6 | pass |
| 25 | x | video | mp3 | ….mp3 | – | mp3 | – | 324.5 / 324.5 | 14.2 | pass |
| 26 | x | short clip | best | Captain America - @King0fNerd … (720p).mp4 | h264 | aac | 720 | 3.2 / 3.17 | 4.5 | pass |
| 27 | x | short clip | gif | Captain America - @King0fNerd … (GIF).gif | gif | – | 270 | 3.2 / 3.17 | 6.2 | pass |
| 28 | instagram | Reel (silent) | audio | error `no_audio` | – | – | – | – | 5.8 | as designed |

"Height" is the stored frame height. Filenames use the short side ("720p" for a 720×1280 Short), as YouTube does. On audio files, ffprobe reports the embedded cover art as a picture stream, which isn't counted as video.

Earlier runs also covered:
- **YouTube 1080p60 H.264 + AAC MP4** (Plays everywhere on), in the browser UI and through the API: h264 + aac, 634.6 s.
- **YouTube video only, 4K AV1:** av1, no audio, 2160 px.
- **Cancel mid-download:** status `cancelled`, job folder deleted, no partial files left in the temp root.
- **Engine update to nightly** from the API: pip installed `2026.11.20.232656.dev0`, the supervisor restarted the engine, and the doctor came back green.

## URL handling checked live

| Input | Result |
|---|---|
| `https://youtu.be/aqz-KE-bpKQ?si=test` | normalised, `si` stripped, video loads |
| `…/watch?v=aqz-KE-bpKQ&list=PL…` | video loads, plus the "This video / Whole playlist" choice |
| `https://m.youtube.com/watch?v=…` | loads (host canonicalised) |
| `https://www.youtube.com/embed/aqz-KE-bpKQ` | loads |
| `https://www.youtube.com/playlist?list=PLa1F2ddGya_-UvuAqHAksYnB0qL9yWDO6` | playlist, 43 entries |
| `https://vxtwitter.com/captainamerica/status/719944021058060289` | rewritten to x.com, loads |
| `https://www.instagram.com/p/BQ0eAlwhDrw/` | carousel, 3 items |
| `https://example.com/` | `unsupported`: "There's no video or audio here." |
| `http://10.0.0.1/x` | `blocked_url` (SSRF guard) |
| `not a link` | `invalid_url` |
| `https://www.instagram.com/p/C0000000000/` (doesn't exist) | `login_required`: Instagram answers missing posts the same way as private ones, so ytdown offers cookies |

## Failures found and fixed during this run

1. **TikTok: every video failed** on stable 2026.10.26 ("Unexpected response from webpage request"). *Fix:* the engine-update flow to nightly; TikTok worked straight away. The stale-engine banner and the Nightly switch in Settings exist for exactly this.
2. **YouTube "best" produced `.mkv` while the UI said MP4.** AV1 + Opus can't go in MP4 the way yt-dlp merges. *Fix:* AV1 merges into WebM, and the merge container is now exactly the one shown on the button.
3. **X "lower" produced `.mkv`.** X's HLS audio tracks have no codec tag, so no companion audio was picked. *Fix:* codec-less m4a/mp4 audio counts as AAC; the site's own MP4 file ("Original") is offered first.
4. **Instagram audio on a silent Reel failed with a raw ffprobe message.** *Fix:* the engine reports `has_audio: false`, the UI disables *Audio only* with "This post has no sound", and the job error maps to a plain `no_audio` state.
5. **Vertical video was labelled by its long side** ("1280p" for a 720×1280 Short). *Fix:* labels use the short side.
6. **TikTok "lower" file had no quality label.** That format reports no dimensions. *Fix:* the label falls back to ffprobe on the finished file.
7. **A one-off YouTube HTTP 403** on a playlist item's audio. It passed on a manual rerun. *Fix:* jobs now retry once with a fresh extraction on 403 before reporting an error.
8. **Error mapping gaps found live:** "Your IP address is blocked from accessing this post" (TikTok) → `region_locked`; "This channel does not have a shorts tab" → `unsupported` (it was wrongly `engine_outdated`).

## Not covered, and why

- **TikTok `vm.`/`vt.` short links:** the only short links available for testing (from yt-dlp's tests) now redirect to TikTok's home page, because their videos were deleted. ytdown follows the redirect and reports "There's no video or audio here." Redirect handling itself is yt-dlp's and works; a live short link still needs testing.
- **A true X animated GIF:** both GIF posts in yt-dlp's test suite are gone. GIF conversion was verified on a 3-second X clip instead (output is a looping GIF, 480 px wide max, no audio).
- **Live streams in progress, age-restricted and region-locked YouTube videos:** these are covered by unit tests on the real yt-dlp error strings (`engine/tests/test_core.py`), not by live links.
- **Playback on QuickTime and on a phone:** not tested here (Windows machine). Plays everywhere MP4s are H.264 + AAC, which both play. AV1/WebM "true best" files need VLC, a browser or a recent Android, and the UI says so next to the toggle.
