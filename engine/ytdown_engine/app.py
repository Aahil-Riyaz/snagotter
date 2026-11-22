"""ytdown engine HTTP API (FastAPI)."""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import tempfile
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

import yt_dlp
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from starlette.middleware.base import BaseHTTPMiddleware

from . import __version__, doctor, errors
from .formats import BadRequest, build_media
from .jobs import TERMINAL, CookieStore, DiskFull, JobManager, base_opts
from .names import content_disposition
from .settings import Settings
from .urls import (BlockedUrl, InvalidUrl, assert_public, detect_platform, normalize, split_batch,
                   youtube_playlist_choice)

settings = Settings.load()
cookies = CookieStore()
manager: JobManager | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global manager
    manager = JobManager(settings, cookies)
    threading.Thread(target=doctor.tools, daemon=True).start()  # warm the cache
    yield
    manager.shutdown()


app = FastAPI(title="ytdown engine", version=__version__, lifespan=lifespan,
              docs_url="/api/docs" if settings.local else None, redoc_url=None)


# ----------------------------------------------------------------------------- middleware

class Guard(BaseHTTPMiddleware):
    """Host check (DNS-rebinding), Origin check on writes (CSRF), PNA preflight, security headers."""

    async def dispatch(self, request: Request, call_next):
        if settings.local:
            host = (request.headers.get("host") or "").split(":")[0].lower()
            if host not in ("127.0.0.1", "localhost", "[::1]", "::1"):
                return JSONResponse({"detail": "Host not allowed"}, status_code=403)
        origin = request.headers.get("origin")
        if request.method in ("POST", "PUT", "DELETE") and origin and origin.rstrip("/") not in settings.origins:
            return JSONResponse({"detail": "Origin not allowed"}, status_code=403)
        response = await call_next(request)
        if request.headers.get("access-control-request-private-network") and origin in settings.origins:
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response


app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_credentials=False,
                   allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["content-type"],
                   expose_headers=["content-disposition"], max_age=600)
app.add_middleware(Guard)

_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(request: Request) -> None:
    if settings.local:
        return
    ip = request.client.host if request.client else "?"
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= settings.rate_per_minute:
        raise HTTPException(429, detail=errors.to_payload("rate_limited", "Per-IP rate limit on this server."))
    q.append(now)


def fail(code: str, details: str | None = None, status: int = 422) -> HTTPException:
    return HTTPException(status, detail=errors.to_payload(code, details))


def require_local() -> None:
    if not settings.local:
        raise HTTPException(403, detail="Only available when ytdown runs on your own computer.")


def checked_url(raw: str) -> str:
    try:
        url = normalize(raw)
        if not settings.local or detect_platform(url) == "other":
            assert_public(url)
        return url
    except BlockedUrl as e:
        raise fail("blocked_url", str(e)) from e
    except InvalidUrl as e:
        raise fail("invalid_url", str(e)) from e


# ----------------------------------------------------------------------------- models

class InfoIn(BaseModel):
    url: str = Field(max_length=4096)


class BatchIn(BaseModel):
    text: str = Field(max_length=100_000)


class SubsIn(BaseModel):
    lang: str = Field(max_length=24)
    auto: bool = False
    embed: bool = True


class TrimIn(BaseModel):
    start: float
    end: float


class OptionsIn(BaseModel):
    subtitles: SubsIn | None = None
    thumbnail: bool = False
    trim: TrimIn | None = None
    embed_meta: bool = True
    gif: bool = False


class ConvertIn(BaseModel):
    codec: Literal["mp3", "m4a", "flac", "wav", "opus"]
    bitrate: int | None = None


class JobIn(BaseModel):
    url: str = Field(max_length=4096)
    mode: Literal["av", "video", "audio"] = "av"
    format_id: str | None = Field(default=None, max_length=64)
    audio_id: str | None = Field(default=None, max_length=64)
    muxed: bool = False
    container: Literal["mp4", "webm", "mkv"] | None = None
    max_height: int | None = None
    compat: bool = False
    convert: ConvertIn | None = None
    options: OptionsIn = OptionsIn()
    items: int | None = Field(default=None, ge=1, le=10000)
    title: str | None = Field(default=None, max_length=500)


class SettingsIn(BaseModel):
    save_dir: str | None = None
    max_concurrent: int | None = Field(default=None, ge=1, le=6)
    ttl_seconds: int | None = Field(default=None, ge=300, le=7 * 86400)
    channel: Literal["stable", "nightly"] | None = None


class BrowserCookiesIn(BaseModel):
    browser: Literal["chrome", "edge", "firefox", "brave", "safari", "opera", "vivaldi", "chromium"]


# ----------------------------------------------------------------------------- info

_CHANNEL_RE = re.compile(r"^/(@[^/]+|channel/[^/]+|c/[^/]+|user/[^/]+)/?$")


def _extract(url: str) -> dict:
    platform = detect_platform(url)
    p = urlsplit(url)
    if platform == "youtube" and _CHANNEL_RE.match(p.path):
        url = urlunsplit((p.scheme, p.netloc, p.path.rstrip("/") + "/videos", p.query, ""))
    work = Path(tempfile.mkdtemp(prefix="info-", dir=settings.temp_dir))
    try:
        opts = base_opts(settings, cookies, work)
        opts.update({
            "skip_download": True,
            "noplaylist": True,
            "playlistend": 500,
            "extract_flat": "in_playlist" if platform in ("youtube", "other") else False,
            "paths": {"home": str(work), "temp": str(work)},
        })
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.sanitize_info(ydl.extract_info(url, download=False))
        return build_media(info, url)
    finally:
        shutil.rmtree(work, ignore_errors=True)


@app.post("/api/info")
async def api_info(body: InfoIn, request: Request):
    rate_limit(request)
    url = checked_url(body.url)
    choice = youtube_playlist_choice(url)
    target = choice["video_url"] if choice else url
    try:
        media = await run_in_threadpool(_extract, target)
    except (yt_dlp.utils.DownloadError, yt_dlp.utils.ExtractorError, OSError) as e:
        raise HTTPException(422, detail=errors.from_exception(e, doctor.engine_age_days())) from e
    if media.get("live_status") in ("is_live", "is_upcoming"):
        raise fail("live_in_progress", f"live_status={media['live_status']}")
    if media["kind"] == "single" and not media["video"] and not media["audio"]:
        raise fail("unsupported", "No downloadable formats were listed for this link.")
    if not settings.local and (media.get("duration") or 0) > settings.max_duration_s:
        raise fail("too_large", f"Duration {media.get('duration')}s is over {settings.max_duration_s}s.")
    media["url"] = target
    media["playlist_choice"] = choice
    return media


@app.post("/api/batch")
async def api_batch(body: BatchIn):
    urls = split_batch(body.text)[:200]
    return {"urls": [{"url": u, "platform": detect_platform(u)} for u in urls]}


# ----------------------------------------------------------------------------- jobs

def _job_or_404(job_id: str):
    job = manager.get(job_id) if manager and re.fullmatch(r"[0-9a-f]{32}", job_id) else None
    if not job:
        raise HTTPException(404, detail="No such download. It may have expired.")
    return job


@app.post("/api/jobs", status_code=201)
async def api_create_job(body: JobIn, request: Request):
    rate_limit(request)
    url = checked_url(body.url)
    req = body.model_dump()
    req["url"] = url
    try:
        job = manager.create(url, req)
    except BadRequest as e:
        raise HTTPException(400, detail=str(e)) from e
    except DiskFull as e:
        raise fail("disk_full", str(e), 507) from e
    return {"job_id": job.id, "job": job.snapshot()}


@app.get("/api/jobs")
async def api_jobs():
    return {"jobs": manager.list()}


@app.get("/api/jobs/{job_id}")
async def api_job(job_id: str):
    return _job_or_404(job_id).snapshot()


@app.get("/api/jobs/{job_id}/events")
async def api_job_events(job_id: str, request: Request):
    job = _job_or_404(job_id)
    q = manager.subscribe(job)

    async def stream():
        try:
            snap = job.snapshot()
            yield f"event: job\ndata: {json.dumps(snap)}\n\n"
            if snap["status"] in TERMINAL:
                return
            while True:
                if await request.is_disconnected():
                    return
                try:
                    snap = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                yield f"event: job\ndata: {json.dumps(snap)}\n\n"
                if snap["status"] in TERMINAL:
                    return
        finally:
            manager.unsubscribe(job, q)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


_MIME = {".mp4": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska", ".mov": "video/quicktime",
         ".gif": "image/gif", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".opus": "audio/ogg",
         ".ogg": "audio/ogg", ".flac": "audio/flac", ".wav": "audio/wav", ".srt": "application/x-subrip",
         ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".aac": "audio/aac"}


@app.get("/api/jobs/{job_id}/file")
async def api_job_file(job_id: str, artifact: Literal["main", "subtitles", "thumbnail"] = "main"):
    job = _job_or_404(job_id)
    if job.status != "ready" or artifact not in job.artifacts:
        raise HTTPException(409, detail="This file isn't ready.")
    path = job.artifacts[artifact]
    if not path.exists() or job.dir not in path.parents:
        raise HTTPException(410, detail="This file was already cleaned up.")
    if artifact == "main":
        job.delivered = time.time()
    return FileResponse(path, media_type=_MIME.get(path.suffix.lower(), "application/octet-stream"),
                        headers={"Content-Disposition": content_disposition(path.name),
                                 "Cache-Control": "no-store"})


@app.post("/api/jobs/{job_id}/save")
async def api_job_save(job_id: str):
    require_local()
    job = _job_or_404(job_id)
    if job.status != "ready" or "main" not in job.artifacts:
        raise HTTPException(409, detail="This file isn't ready.")
    dest_dir = Path(settings.save_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    src = job.artifacts["main"]
    dest = dest_dir / src.name
    n = 2
    while dest.exists():
        dest = dest_dir / f"{src.stem} ({n}){src.suffix}"
        n += 1
    await run_in_threadpool(shutil.copy2, src, dest)
    job.saved_to = str(dest)
    job.delivered = time.time()
    return job.snapshot()


@app.delete("/api/jobs/{job_id}")
async def api_cancel(job_id: str):
    job = _job_or_404(job_id)
    manager.cancel_job(job)
    return {"ok": True, "status": job.status}


# ----------------------------------------------------------------------------- engine / settings

@app.get("/api/doctor")
async def api_doctor():
    rep = await run_in_threadpool(doctor.report)
    rep.update({"app_version": __version__, "mode": settings.mode,
                "cookies": cookies.active if settings.local else None,
                "can_update": settings.local, "supervised": os.environ.get("YTDOWN_SUPERVISED") == "1"})
    return rep


@app.post("/api/engine/update")
async def api_update(body: SettingsIn | None = None):
    require_local()
    channel = (body.channel if body and body.channel else settings.channel)
    if manager and any(j.status not in TERMINAL for j in manager.jobs.values()):
        raise HTTPException(409, detail="Wait for downloads to finish before updating the engine.")
    result = await run_in_threadpool(doctor.update_engine, channel)
    if channel != settings.channel:
        settings.channel = channel
        settings.save()
    restart = result["ok"] and os.environ.get("YTDOWN_SUPERVISED") == "1"
    task = BackgroundTask(_restart) if restart else None
    return JSONResponse({**result, "restarting": restart,
                         "restart_required": result["ok"] and not restart}, background=task)


async def _restart():
    await asyncio.sleep(0.5)
    os._exit(3)  # the supervisor in __main__ restarts us with the new yt-dlp


@app.get("/api/settings")
async def api_settings():
    return settings.public()


@app.put("/api/settings")
async def api_put_settings(body: SettingsIn):
    require_local()
    if body.save_dir is not None:
        p = Path(body.save_dir).expanduser()
        if not p.is_absolute():
            raise HTTPException(400, detail="Use a full folder path.")
        try:
            p.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            raise HTTPException(400, detail="That folder can't be created.") from e
        settings.save_dir = str(p.resolve())
    if body.max_concurrent is not None:
        settings.max_concurrent = body.max_concurrent
    if body.ttl_seconds is not None:
        settings.ttl_seconds = body.ttl_seconds
    if body.channel is not None:
        settings.channel = body.channel
    settings.save()
    return settings.public()


@app.post("/api/cookies/file")
async def api_cookies_file(file: UploadFile = File(...)):
    require_local()
    raw = await file.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise HTTPException(413, detail="That cookies file is too large.")
    text = raw.decode("utf-8", errors="replace")
    if "# Netscape HTTP Cookie File" not in text[:500] and "\t" not in text:
        raise HTTPException(400, detail="That isn't a cookies.txt file (Netscape format).")
    cookies.set_text(text)
    return {"cookies": cookies.active}


@app.post("/api/cookies/browser")
async def api_cookies_browser(body: BrowserCookiesIn):
    require_local()
    cookies.set_browser(body.browser)
    return {"cookies": cookies.active, "browser": body.browser}


@app.delete("/api/cookies")
async def api_cookies_clear():
    cookies.clear()
    return {"cookies": None}


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException):
    detail = exc.detail
    body = {"error": detail} if isinstance(detail, dict) else {"error": {"code": "request", "title": str(detail),
                                                                         "hint": None, "action": None,
                                                                         "action_label": None, "details": None}}
    return JSONResponse(body, status_code=exc.status_code, headers=getattr(exc, "headers", None))


# ----------------------------------------------------------------------------- static PWA

_dist = Path(os.environ.get("YTDOWN_WEB_DIST", Path(__file__).resolve().parents[2] / "web" / "dist"))
if _dist.is_dir():
    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, detail="Not found")
        target = (_dist / path).resolve()
        if path and target.is_file() and _dist.resolve() in target.parents:
            if "/assets/" in f"/{path}":
                headers = {"Cache-Control": "public, max-age=31536000, immutable"}
            else:  # sw.js, manifest, icons: always revalidate so PWA updates land
                headers = {"Cache-Control": "no-cache"}
            return FileResponse(target, headers=headers)
        return FileResponse(_dist / "index.html", headers={"Cache-Control": "no-cache"})
