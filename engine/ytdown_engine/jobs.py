"""Download jobs: a small thread pool, yt-dlp hooks -> throttled snapshots -> SSE subscribers."""
from __future__ import annotations

import asyncio
import os
import re
import shutil
from urllib.parse import urlsplit
import subprocess
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import yt_dlp
from yt_dlp.utils import DownloadCancelled, download_range_func

from . import doctor, errors
from .formats import Plan, build_plan, quality_label, safe_plan, short_side
from .names import build_filename
from .settings import Settings

TERMINAL = {"ready", "failed", "cancelled"}
THROTTLE = 0.25
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


class CookieStore:
    """The user's own cookies, held in memory only. Never logged, never sent anywhere but the site."""

    def __init__(self) -> None:
        self._text: str | None = None
        self.browser: str | None = None
        self._lock = threading.Lock()

    def set_text(self, text: str) -> None:
        with self._lock:
            self._text, self.browser = text, None

    def set_browser(self, browser: str) -> None:
        with self._lock:
            self._text, self.browser = None, browser

    def clear(self) -> None:
        with self._lock:
            self._text, self.browser = None, None

    @property
    def active(self) -> str | None:
        return "file" if self._text else ("browser" if self.browser else None)

    def apply(self, opts: dict, workdir: Path) -> None:
        with self._lock:
            if self._text:
                p = workdir / ".cookies.txt"
                p.write_text(self._text, encoding="utf-8")
                try:
                    os.chmod(p, 0o600)
                except OSError:
                    pass
                opts["cookiefile"] = str(p)
            elif self.browser:
                opts["cookiesfrombrowser"] = (self.browser,)


class _QuietLogger:
    def __init__(self) -> None:
        self.last_error: str | None = None

    def debug(self, msg: str) -> None:  # noqa: D401 - yt-dlp logger API
        pass

    def info(self, msg: str) -> None:
        pass

    def warning(self, msg: str) -> None:
        pass

    def error(self, msg: str) -> None:
        self.last_error = msg


# Failures that come from the chosen format or from merging/converting it, not from the site itself.
_FORMAT_TROUBLE = re.compile(
    r"postprocessing|requested format is not available|merg|ffmpeg|conversion failed|invalid data found|"
    r"could not write header|not currently supported in container|incorrect codec parameters|"
    r"unable to (download|extract) .*format|fragment", re.I)


def _site_of(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    for site, marks in (("youtube", ("youtube.com", "youtu.be")), ("tiktok", ("tiktok.com",)),
                        ("instagram", ("instagram.com",)), ("x", ("x.com", "twitter.com"))):
        if any(host == m or host.endswith("." + m) for m in marks):
            return site
    return "other"


def base_opts(settings: Settings, cookies: CookieStore, workdir: Path, url: str = "") -> dict:
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": _QuietLogger(),
        "socket_timeout": 20,
        "retries": 3,
        "fragment_retries": 5,
        "concurrent_fragment_downloads": 4,
        "windowsfilenames": True,
        "js_runtimes": doctor.js_runtimes(),
        "cachedir": str(Path(settings.temp_dir) / ".cache"),
    }
    loc = doctor.ffmpeg_location()
    if loc:
        opts["ffmpeg_location"] = loc
    site = _site_of(url)
    if settings.proxy and ("all" in settings.proxy_sites or site in settings.proxy_sites):
        opts["proxy"] = settings.proxy
    if settings.local:
        cookies.apply(opts, workdir)
    else:
        opts["allowed_extractors"] = ["default", "-generic"]
        # A server owner can give the engine one account's cookies (for example a spare Instagram
        # account, so Stories work). They're copied per job because yt-dlp rewrites the file.
        src = Path(settings.cookies_file) if settings.cookies_file else None
        if src and src.is_file() and ("all" in settings.cookie_sites or site in settings.cookie_sites):
            dst = workdir / "cookies.txt"
            shutil.copyfile(src, dst)
            opts["cookiefile"] = str(dst)
    return opts


@dataclass
class Job:
    url: str
    req: dict
    plan: Plan
    dir: Path
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: str = "queued"
    percent: float | None = None
    speed: float | None = None
    eta: int | None = None
    downloaded: int | None = None
    total: int | None = None
    title: str | None = None
    uploader: str | None = None
    filename: str | None = None
    size: int | None = None
    artifacts: dict[str, Path] = field(default_factory=dict)
    error: dict | None = None
    saved_to: str | None = None
    created: float = field(default_factory=time.time)
    finished: float | None = None
    delivered: float | None = None
    cancel: threading.Event = field(default_factory=threading.Event)
    future: Future | None = None
    subscribers: list = field(default_factory=list)
    last_emit: float = 0.0

    def snapshot(self) -> dict:
        return {
            "id": self.id, "url": self.url, "status": self.status, "mode": self.req.get("mode"),
            "percent": None if self.percent is None else round(self.percent, 1),
            "speed": self.speed, "eta": self.eta, "downloaded": self.downloaded, "total": self.total,
            "title": self.title, "uploader": self.uploader, "filename": self.filename, "size": self.size,
            "extras": [k for k in self.artifacts if k != "main"],
            "error": self.error, "saved_to": self.saved_to, "created": self.created,
        }


class JobManager:
    def __init__(self, settings: Settings, cookies: CookieStore) -> None:
        self.settings = settings
        self.cookies = cookies
        self.jobs: dict[str, Job] = {}
        self.pool = ThreadPoolExecutor(max_workers=settings.max_concurrent, thread_name_prefix="ytdown-job")
        self.root = Path(settings.temp_dir)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._stop = threading.Event()
        threading.Thread(target=self._sweeper, daemon=True, name="ytdown-sweeper").start()

    # ------------------------------------------------------------------ public API
    def create(self, url: str, req: dict) -> Job:
        plan = build_plan(req)  # raises formats.BadRequest
        if self.disk_usage() > self.settings.max_temp_bytes:
            raise errors_disk_full()
        jdir = self.root / uuid.uuid4().hex
        jdir.mkdir(parents=True)
        job = Job(url=url, req=req, plan=plan, dir=jdir)
        job.title = req.get("title")
        with self._lock:
            self.jobs[job.id] = job
        job.future = self.pool.submit(self._run, job)
        return job

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    def list(self) -> list[dict]:
        return [j.snapshot() for j in sorted(self.jobs.values(), key=lambda j: j.created)]

    def cancel_job(self, job: Job) -> None:
        job.cancel.set()
        if job.future and job.future.cancel():
            self._finish(job, "cancelled")
        elif job.status in TERMINAL:
            self._remove(job)

    def subscribe(self, job: Job) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        job.subscribers.append((asyncio.get_running_loop(), q))
        return q

    def unsubscribe(self, job: Job, q: asyncio.Queue) -> None:
        job.subscribers[:] = [(lp, qq) for lp, qq in job.subscribers if qq is not q]

    def disk_usage(self) -> int:
        total = 0
        for p in self.root.rglob("*"):
            try:
                if p.is_file():
                    total += p.stat().st_size
            except OSError:
                pass
        return total

    def shutdown(self) -> None:
        self._stop.set()
        for j in self.jobs.values():
            j.cancel.set()
        self.pool.shutdown(wait=False, cancel_futures=True)

    # ------------------------------------------------------------------ events
    def _emit(self, job: Job, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - job.last_emit < THROTTLE:
            return
        job.last_emit = now
        snap = job.snapshot()
        for loop, q in list(job.subscribers):
            def put(q=q, snap=snap):
                if q.full():
                    try:
                        q.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                q.put_nowait(snap)
            try:
                loop.call_soon_threadsafe(put)
            except RuntimeError:  # loop closed
                pass

    def _set(self, job: Job, status: str, **kw) -> None:
        changed = status != job.status
        job.status = status
        for k, v in kw.items():
            setattr(job, k, v)
        self._emit(job, force=changed)

    # ------------------------------------------------------------------ worker
    def _progress_hook(self, job: Job, d: dict) -> None:
        if job.cancel.is_set():
            raise DownloadCancelled("Cancelled by user")
        if d.get("status") != "downloading":
            return
        info = d.get("info_dict") or {}
        vc = info.get("vcodec")
        if job.req.get("mode") == "audio" or (vc == "none"):
            stage = "downloading_audio"
        else:
            stage = "downloading_video"
        done = d.get("downloaded_bytes")
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        pct = None
        if done is not None and total:
            pct = min(100.0, done * 100.0 / total)
        elif d.get("fragment_index") and d.get("fragment_count"):
            pct = d["fragment_index"] * 100.0 / d["fragment_count"]
        job.status, job.percent, job.downloaded, job.total = stage, pct, done, int(total) if total else None
        job.speed = round(d["speed"]) if d.get("speed") else None
        job.eta = int(d["eta"]) if d.get("eta") is not None else None
        if not job.title and info.get("title"):
            job.title, job.uploader = info.get("title"), info.get("uploader")
        self._emit(job, force=stage != getattr(job, "_last_stage", None))
        job._last_stage = stage  # type: ignore[attr-defined]

    def _pp_hook(self, job: Job, d: dict) -> None:
        if d.get("status") != "started":
            return
        pp = d.get("postprocessor") or ""
        if pp == "Merger":
            self._set(job, "merging", percent=None, speed=None, eta=None)
        elif pp in ("ExtractAudio", "VideoConvertor", "FFmpegExtractAudio"):
            self._set(job, "converting", percent=None, speed=None, eta=None)

    def _ydl_opts(self, job: Job) -> dict:
        s = self.settings
        opts = base_opts(s, self.cookies, job.dir, job.url)
        p = job.plan
        opts.update({
            "format": p.format,
            "paths": {"home": str(job.dir), "temp": str(job.dir / "part")},
            "outtmpl": {"default": "%(id)s.%(ext)s"},
            "progress_hooks": [lambda d: self._progress_hook(job, d)],
            "postprocessor_hooks": [lambda d: self._pp_hook(job, d)],
            "postprocessors": [dict(x) for x in p.postprocessors],
            "overwrites": True,
            "continuedl": False,
            "noplaylist": not job.req.get("items"),
        })
        if p.merge_output_format:
            opts["merge_output_format"] = p.merge_output_format
        if job.req.get("items"):
            opts["playlist_items"] = str(job.req["items"])
        for k, v in p.extra.items():
            if k == "trim":
                opts["download_ranges"] = download_range_func(None, [v])
                opts["force_keyframes_at_cuts"] = False
            else:
                opts[k] = v
        if not s.local:
            opts["max_filesize"] = s.max_filesize_mb * 1024 * 1024
            limit = s.max_duration_s
            opts["match_filter"] = lambda info, *a, **k: (
                "This is longer than this server allows." if (info.get("duration") or 0) > limit else None)
        return opts

    @staticmethod
    def _clear_dir(job: Job) -> None:
        for p in job.dir.iterdir():
            shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink(missing_ok=True)

    def _run(self, job: Job) -> None:
        if job.cancel.is_set():
            return self._finish(job, "cancelled")
        self._set(job, "fetching")
        try:
            opts = self._ydl_opts(job)
            retried_403 = used_safe = False
            while True:
                try:
                    with yt_dlp.YoutubeDL(opts) as ydl:
                        info = ydl.extract_info(job.url, download=True)
                        info = ydl.sanitize_info(info)
                    break
                except yt_dlp.utils.DownloadError as e:
                    if job.cancel.is_set():
                        raise
                    msg = f"{e}\n{opts['logger'].last_error or ''}"
                    if "403" in msg and not retried_403:
                        # Signed media URLs sometimes expire or get a one-off 403; a fresh extraction fixes it.
                        retried_403 = True
                    elif _FORMAT_TROUBLE.search(msg) and not used_safe:
                        # The picked format couldn't be fetched or merged: fall back to whatever works best,
                        # so pressing Download always gives the person a file.
                        used_safe = True
                        job.plan = safe_plan(job.plan, job.req.get("mode"))
                        self._clear_dir(job)
                    else:
                        raise
                    self._set(job, "fetching", percent=None)
                    opts = self._ydl_opts(job)
            if job.cancel.is_set():
                return self._finish(job, "cancelled")
            if info.get("entries"):
                info = next((e for e in info["entries"] if e), info)
            if info.get("live_status") in ("is_live", "is_upcoming"):
                raise RuntimeError("This live event is still in progress")
            main = self._find_main(job, info)
            if job.plan.strip_audio and self.settings and main.suffix.lower() != ".gif":
                self._set(job, "converting", percent=None)
                main = self._strip_audio(main)
            if job.plan.to_gif:
                self._set(job, "converting", percent=None)
                main = self._to_gif(main)
            elif (job.req.get("compat") and job.req.get("mode") in ("av", "video")
                  and main.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov")):
                vcodec, acodec = self._codecs(main)
                if vcodec and vcodec != "h264":
                    self._set(job, "converting", percent=None)
                    main = self._to_h264(main, acodec)
            self._collect_extras(job, main)
            label = self._label(job, info, main)
            final = job.dir / build_filename(info.get("title"), info.get("uploader") or info.get("channel"),
                                             label, main.suffix.lstrip("."))
            if final != main:
                main.replace(final)
            job.artifacts["main"] = final
            job.title = info.get("title") or job.title
            job.uploader = info.get("uploader") or info.get("channel")
            job.filename = final.name
            job.size = final.stat().st_size
            self._finish(job, "ready", percent=100.0)
        except DownloadCancelled:
            self._finish(job, "cancelled")
        except Exception as exc:  # noqa: BLE001 - every failure becomes a user-facing state
            if job.cancel.is_set():
                return self._finish(job, "cancelled")
            logger = (opts or {}).get("logger") if "opts" in locals() else None
            text = str(exc)
            if logger and logger.last_error and logger.last_error not in text:
                text = f"{text}\n{logger.last_error}"
            if "longer than this server allows" in text:
                job.error = errors.to_payload("too_large", text)
            else:
                job.error = errors.from_exception(RuntimeError(text), doctor.engine_age_days(), hosted=not self.settings.local)
            self._finish(job, "failed")

    def _find_main(self, job: Job, info: dict) -> Path:
        for rd in reversed(info.get("requested_downloads") or []):
            fp = rd.get("filepath") or rd.get("_filename")
            if fp and Path(fp).exists():
                return Path(fp)
        skip = {".part", ".ytdl", ".srt", ".vtt", ".jpg", ".jpeg", ".png", ".webp", ".txt", ".json"}
        files = [p for p in job.dir.glob("*") if p.is_file() and p.suffix.lower() not in skip
                 and not p.name.startswith(".")]
        if not files:
            raise RuntimeError("The download finished but no file was produced.")
        return max(files, key=lambda p: p.stat().st_size)

    def _collect_extras(self, job: Job, main: Path) -> None:
        for p in job.dir.glob("*"):
            if not p.is_file() or p == main or p.name.startswith("."):
                continue
            ext = p.suffix.lower()
            if ext in (".srt", ".vtt"):
                job.artifacts["subtitles"] = p
            elif ext in (".jpg", ".jpeg", ".png", ".webp") and job.req.get("options", {}).get("thumbnail"):
                job.artifacts["thumbnail"] = p

    def _label(self, job: Job, info: dict, main: Path) -> str | None:
        if job.plan.to_gif:
            return "GIF"
        mode = job.req.get("mode")
        if mode == "audio":
            return None
        rd = (info.get("requested_downloads") or [{}])[-1]
        w = info.get("width") or rd.get("width")
        h = info.get("height") or rd.get("height")
        if not h:
            vids = [f for f in (info.get("requested_formats") or []) if f.get("height")]
            if vids:
                w, h = vids[0].get("width"), vids[0].get("height")
        if not h:
            w, h = self._probe_size(main)
        side = short_side(w, h)
        lbl = quality_label(side) if side else None
        if mode == "video" and lbl:
            return f"{lbl}, no audio"
        return lbl

    def _probe_size(self, path: Path) -> tuple[int | None, int | None]:
        """Some sites don't report dimensions; read them from the finished file instead."""
        exe = doctor.tools()["ffprobe"]["path"]
        if not exe:
            return None, None
        try:
            out = subprocess.run([exe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                                  "-of", "csv=p=0", str(path)], capture_output=True, text=True, timeout=30,
                                 creationflags=_NO_WINDOW)
            w, h = (int(x) for x in out.stdout.strip().split(",")[:2])
            return w, h
        except (ValueError, OSError, subprocess.SubprocessError):
            return None, None

    def _ffmpeg(self) -> str:
        path = doctor.tools()["ffmpeg"]["path"]
        if not path:
            raise RuntimeError("ffmpeg not found")
        return path

    def _strip_audio(self, src: Path) -> Path:
        dst = src.with_name(src.stem + ".noaudio" + src.suffix)
        subprocess.run([self._ffmpeg(), "-v", "error", "-y", "-i", str(src), "-map", "0:v", "-c", "copy",
                        "-an", str(dst)], check=True, capture_output=True, timeout=1800, creationflags=_NO_WINDOW)
        src.unlink(missing_ok=True)
        return dst

    def _codecs(self, path: Path) -> tuple[str | None, str | None]:
        """(video codec, audio codec) of a finished file, as ffprobe names them."""
        exe = doctor.tools()["ffprobe"]["path"]
        if not exe:
            return None, None
        try:
            out = subprocess.run([exe, "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "csv=p=0",
                                  str(path)], capture_output=True, text=True, timeout=30, creationflags=_NO_WINDOW)
        except (OSError, subprocess.SubprocessError):
            return None, None
        v = a = None
        for line in out.stdout.splitlines():
            name, _, kind = line.partition(",")
            if kind.strip() == "video" and not v:
                v = name.strip()
            elif kind.strip() == "audio" and not a:
                a = name.strip()
        return v, a

    def _to_h264(self, src: Path, acodec: str | None) -> Path:
        """'Plays everywhere' when the site only offers VP9/AV1: H.264 + AAC in MP4, same resolution."""
        dst = src.with_name(src.stem + ".h264.mp4")
        audio = ["-c:a", "copy"] if acodec == "aac" else ["-c:a", "aac", "-b:a", "192k"]
        subprocess.run([self._ffmpeg(), "-v", "error", "-y", "-i", str(src), "-map", "0:v:0", "-map", "0:a?",
                        # superfast + a bitrate cap: about 1 s per second of 1080p video on a 2-core server,
                        # and files near the source size instead of several times bigger.
                        "-c:v", "libx264", "-preset", "superfast", "-crf", "23", "-maxrate", "4M", "-bufsize", "8M",
                        "-pix_fmt", "yuv420p",
                        *audio, "-movflags", "+faststart", str(dst)],
                       check=True, capture_output=True, timeout=3600, creationflags=_NO_WINDOW)
        src.unlink(missing_ok=True)
        return dst

    def _to_gif(self, src: Path) -> Path:
        dst = src.with_suffix(".gif")
        vf = "fps=15,scale='min(480,iw)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4"
        subprocess.run([self._ffmpeg(), "-v", "error", "-y", "-i", str(src), "-vf", vf, "-loop", "0", str(dst)],
                       check=True, capture_output=True, timeout=900, creationflags=_NO_WINDOW)
        src.unlink(missing_ok=True)
        return dst

    def _finish(self, job: Job, status: str, **kw) -> None:
        job.finished = time.time()
        if status in ("cancelled", "failed"):
            job.percent = None if status == "cancelled" else job.percent
            shutil.rmtree(job.dir, ignore_errors=True)
            job.artifacts.clear()
            if status == "cancelled":
                job.error = errors.to_payload("cancelled")
        else:
            # cookies never outlive the job
            (job.dir / ".cookies.txt").unlink(missing_ok=True)
            shutil.rmtree(job.dir / "part", ignore_errors=True)
        self._set(job, status, speed=None, eta=None, **kw)

    def _remove(self, job: Job) -> None:
        shutil.rmtree(job.dir, ignore_errors=True)
        with self._lock:
            self.jobs.pop(job.id, None)

    def _sweeper(self) -> None:
        while not self._stop.wait(60):
            now = time.time()
            ttl = self.settings.ttl_seconds
            for job in list(self.jobs.values()):
                if job.status not in TERMINAL:
                    continue
                if (job.delivered and now - job.delivered > 300) or (job.finished and now - job.finished > ttl):
                    self._remove(job)
            known = {j.dir.name for j in self.jobs.values()}
            for d in self.root.iterdir():
                try:
                    if d.is_dir() and not d.name.startswith(".") and d.name not in known \
                            and now - d.stat().st_mtime > ttl:
                        shutil.rmtree(d, ignore_errors=True)
                except OSError:
                    pass


class DiskFull(Exception):
    pass


def errors_disk_full() -> DiskFull:
    return DiskFull("no space left in the ytdown temp folder")
