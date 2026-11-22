"""Turn yt-dlp info dicts into ytdown's media JSON, and build format selectors.

Nothing here talks to the network; it is pure data shaping so it can be unit-tested.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from datetime import datetime

from .urls import detect_platform

FORMAT_ID_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")
LANG_RE = re.compile(r"^[A-Za-z0-9_\-]{1,24}$")

CODEC_ORDER = ["AV1", "VP9", "H.265", "H.264", "VP8"]
AUDIO_KEEP = {"Opus", "AAC", "MP3", "Vorbis", "FLAC"}
CONVERT_CODECS = {"mp3", "m4a", "flac", "wav", "opus"}
CONVERT_BITRATES = {320, 256, 192, 160, 128, 96}


# ----------------------------------------------------------------------------- helpers

def _none(v) -> bool:
    return v in (None, "none", "")


def video_codec(vcodec: str | None) -> str:
    v = (vcodec or "").lower()
    if v.startswith(("avc1", "avc3", "h264")):
        return "H.264"
    if v.startswith(("av01", "av1")):
        return "AV1"
    if v.startswith(("vp09", "vp9")):
        return "VP9"
    if v.startswith(("hev1", "hvc1", "h265", "hevc")):
        return "H.265"
    if v.startswith("vp8"):
        return "VP8"
    return "Original" if not v else v.split(".")[0].upper()


def audio_codec(acodec: str | None) -> str:
    a = (acodec or "").lower()
    if a.startswith("opus"):
        return "Opus"
    if a.startswith(("mp4a", "aac")):
        return "AAC"
    if a.startswith("mp3"):
        return "MP3"
    if a.startswith("vorbis"):
        return "Vorbis"
    if a.startswith("flac"):
        return "FLAC"
    if a.startswith("ac-3"):
        return "AC-3"
    if a.startswith("ec-3"):
        return "E-AC-3"
    return "Unknown" if not a else a.split(".")[0].upper()


def quality_label(height: int | None) -> str:
    if not height:
        return "Source"
    if height >= 4320:
        return "8K"
    if height >= 2160:
        return "4K"
    if height >= 1440:
        return "2K"
    return f"{height}p"


def _skip(f: dict) -> bool:
    fid = str(f.get("format_id") or "")
    note = (f.get("format_note") or "").lower()
    return (
        f.get("ext") == "mhtml"
        or "storyboard" in note
        or fid.endswith("-drc")
        or bool(f.get("has_drm"))
        or (f.get("protocol") or "").startswith(("mhtml", "f4m"))
    )


def _is_video(f: dict) -> bool:
    if not _none(f.get("vcodec")):
        return True
    # Some extractors leave vcodec unset on progressive files but give a height, or (Facebook) nothing
    # at all except a video file type.
    if f.get("vcodec") is not None or f.get("ext") in ("m4a", "mp3", "opus", "aac", "wav", "flac"):
        return False
    return bool(f.get("height") or f.get("width")) or f.get("ext") in ("mp4", "webm", "mov", "mkv", "flv", "3gp")


def _has_audio(f: dict) -> bool:
    if f.get("acodec") == "none":
        return False
    if not _none(f.get("acodec")):
        return True
    if f.get("vcodec") == "none":  # explicitly video-less: it's an audio track whose codec isn't reported
        return True
    # Unknown codecs on a "video" format from a single-file site: assume muxed.
    return f.get("vcodec") is None and f.get("acodec") is None


@dataclass
class Size:
    bytes: int | None
    approx: bool

    def __add__(self, other: "Size") -> "Size":
        if self.bytes is None or other.bytes is None:
            return Size(None, True)
        return Size(self.bytes + other.bytes, self.approx or other.approx)

    def json(self) -> dict:
        return {"bytes": self.bytes, "approx": self.approx}


def format_size(f: dict, duration: float | None) -> Size:
    if f.get("filesize"):
        return Size(int(f["filesize"]), False)
    if f.get("filesize_approx"):
        return Size(int(f["filesize_approx"]), True)
    tbr = f.get("tbr") or ((f.get("vbr") or 0) + (f.get("abr") or 0)) or None
    if tbr and duration:
        return Size(int(tbr * 125 * duration), True)
    return Size(None, True)


def _rank(f: dict) -> tuple:
    """Higher is better among duplicates of the same codec/resolution."""
    proto = f.get("protocol") or ""
    return (
        "watermark" not in (f.get("format_note") or "").lower(),
        not proto.startswith("m3u8"),
        bool(f.get("filesize") or f.get("filesize_approx")),
        f.get("tbr") or 0,
    )


def merge_container(codec: str, source_ext: str | None = None, audio: str | None = None) -> str:
    # WebM only holds Opus/Vorbis audio. VP9/AV1 paired with AAC (Instagram, some X posts) goes in MP4,
    # which holds both and plays on iPhones.
    if codec in ("AV1", "VP9"):
        return "webm" if audio in (None, "Opus", "Vorbis") else "mp4"
    if codec in ("H.264", "H.265"):
        return "mp4"
    return source_ext if source_ext in ("mp4", "webm") else "mkv"


# ----------------------------------------------------------------------------- audio

def audio_options(formats: list[dict], duration: float | None) -> list[dict]:
    best: dict[tuple, dict] = {}
    for f in formats:
        if _skip(f) or _is_video(f) or not _has_audio(f):
            continue
        codec = _audio_codec_of(f)
        if codec not in AUDIO_KEEP:
            continue
        abr = round(f.get("abr") or f.get("tbr") or 0)
        key = (codec, abr // 8, (f.get("audio_channels") or 2) > 2)
        if key not in best or _rank(f) > _rank(best[key]):
            best[key] = f
    out = []
    for f in best.values():
        codec = _audio_codec_of(f)
        abr = round(f.get("abr") or f.get("tbr") or 0) or None
        ch = f.get("audio_channels")
        out.append({
            "format_id": str(f["format_id"]),
            "codec": codec,
            "abr": abr,
            "channels": ch,
            "surround": bool(ch and ch > 2),
            "ext": f.get("ext"),
            "size": format_size(f, duration).json(),
            "language": f.get("language"),
        })
    # Tracks with no reported bitrate are usually HLS copies of ones we already have; keep them only as a last resort.
    if any(a["abr"] for a in out):
        out = [a for a in out if a["abr"]]
    # stereo first (plays everywhere), then bitrate; surround tracks are listed but never the default
    out.sort(key=lambda a: (not a["surround"], a["abr"] or 0, a["codec"] == "Opus"), reverse=True)
    return out


def _audio_codec_of(f: dict) -> str:
    c = audio_codec(f.get("acodec"))
    if c == "Unknown" and f.get("vcodec") == "none" and f.get("ext") in ("m4a", "mp4", "aac"):
        return "AAC"
    if c == "Unknown" and f.get("vcodec") == "none" and f.get("ext") in ("webm", "opus"):
        return "Opus"
    return c


def short_side(w: int | None, h: int | None) -> int | None:
    """Quality is named after the short side: a 720x1280 Short is '720p', as YouTube does."""
    if w and h:
        return min(w, h)
    return h


def companion_audio(audio: list[dict], codec: str) -> dict | None:
    """Best audio track to pair with a video codec when merging."""
    if not audio:
        return None
    want = "AAC" if codec in ("H.264", "H.265") else "Opus"
    stereo = [a for a in audio if not a["surround"]] or audio
    for a in stereo:
        if a["codec"] == want:
            return a
    return stereo[0]


# ----------------------------------------------------------------------------- video

_NAMELESS_LABEL = {"hd": "HD", "sd": "SD"}
_NAMELESS_RANK = {"hd": 2, "sd": 1}


def video_groups(formats: list[dict], duration: float | None, audio: list[dict]) -> list[dict]:
    buckets: dict[tuple, dict[str, dict]] = {}
    for f in formats:
        if _skip(f) or not _is_video(f):
            continue
        h = short_side(f.get("width"), f.get("height"))
        fps = round(f["fps"]) if f.get("fps") else None
        hdr = not _none(f.get("dynamic_range")) and f.get("dynamic_range") != "SDR"
        codec = video_codec(f.get("vcodec"))
        # No resolution reported (Facebook's "hd"/"sd"): keep each as its own row instead of merging them.
        key = (h or 0, fps or 0, hdr, "" if h else str(f.get("format_id")))
        fam = buckets.setdefault(key, {})
        if codec not in fam or _rank(f) > _rank(fam[codec]):
            fam[codec] = f

    groups = []
    for (h, fps, hdr, nameless), fam in buckets.items():
        variants = []
        for codec, f in fam.items():
            muxed = _has_audio(f)
            v_size = format_size(f, duration)
            comp = None if muxed else companion_audio(audio, codec)
            av_size = v_size if muxed else (
                v_size + Size(comp["size"]["bytes"], comp["size"]["approx"]) if comp else Size(v_size.bytes, True))
            variants.append({
                "format_id": str(f["format_id"]),
                "codec": codec,
                "muxed": muxed,
                "audio_id": comp["format_id"] if comp else None,
                "audio_codec": audio_codec(f.get("acodec")) if muxed else (comp["codec"] if comp else None),
                "container": (f.get("ext") or "mp4") if muxed else merge_container(codec, f.get("ext"), comp["codec"] if comp else None),
                "source_ext": f.get("ext"),
                "tbr": round(f["tbr"]) if f.get("tbr") else None,
                "size_av": av_size.json(),
                "size_v": v_size.json(),
                "watermarked": "watermark" in (f.get("format_note") or "").lower(),
                "width": f.get("width"),
                "height": f.get("height"),
            })
        variants.sort(key=lambda v: (v["watermarked"],
                                     CODEC_ORDER.index(v["codec"]) if v["codec"] in CODEC_ORDER else 99))
        # A site's own ready-made file (codec not reported) needs no merging: offer it first.
        variants.sort(key=lambda v: 0 if (v["codec"] == "Original" and v["muxed"]) else 1)
        best_tbr = max((v["tbr"] or 0) for v in variants)
        groups.append({
            "key": f"{h}p{fps or ''}{'-hdr' if hdr else ''}" if h else f"src-{nameless}",
            "height": h or None,
            "fps": fps or None,
            "hdr": hdr,
            "label": quality_label(h or None) if h else _NAMELESS_LABEL.get(nameless.lower(), "Source"),
            "res": f"{h}p" if h else None,
            "variants": variants,
            "_sort": (h, fps, hdr, _NAMELESS_RANK.get(nameless.lower(), 0), best_tbr),
        })
    groups.sort(key=lambda g: g["_sort"], reverse=True)
    for i, g in enumerate(groups):
        g.pop("_sort")
        g["best"] = i == 0
    return groups


# ----------------------------------------------------------------------------- media

def _date(d: str | None) -> str | None:
    if d and re.fullmatch(r"\d{8}", d):
        return datetime.strptime(d, "%Y%m%d").date().isoformat()
    return None


def _thumb(info: dict) -> str | None:
    if info.get("thumbnail"):
        return info["thumbnail"]
    thumbs = [t for t in (info.get("thumbnails") or []) if t.get("url")]
    if not thumbs:
        return None
    thumbs.sort(key=lambda t: (t.get("preference") or 0, t.get("width") or 0))
    return thumbs[-1]["url"]


def aspect(info: dict, groups: list[dict], url: str) -> str:
    if "/shorts/" in url or "/reel" in url:
        return "9:16"
    w = info.get("width")
    h = info.get("height")
    if not (w and h):
        for g in groups:
            v = g["variants"][0]
            if v.get("width") and v.get("height"):
                w, h = v["width"], v["height"]
                break
    if not (w and h):
        return "9:16" if detect_platform(url) == "tiktok" else "16:9"
    r = w / h
    if r < 0.8:
        return "9:16"
    if r < 1.2:
        return "1:1"
    return "16:9"


def subtitle_langs(info: dict) -> dict:
    manual = sorted(k for k in (info.get("subtitles") or {}) if k != "live_chat")
    auto = info.get("automatic_captions") or {}
    orig = [k for k in auto if k.endswith("-orig")]
    common = [k for k in ("en", "es", "fr", "de", "pt", "ar", "hi", "ja", "ko", "zh-Hans", "ru", "it")
              if k in auto]
    return {"manual": manual, "auto": (orig + common)[:12]}


def build_media(info: dict, url: str) -> dict:
    """Normalise a yt-dlp info dict (single item or playlist) into ytdown JSON."""
    platform = detect_platform(info.get("webpage_url") or url)
    base = {
        "id": info.get("id"),
        "title": info.get("title") or info.get("id") or "Untitled",
        "uploader": info.get("uploader") or info.get("channel") or info.get("uploader_id"),
        "platform": platform,
        "extractor": info.get("extractor_key") or info.get("extractor"),
        "webpage_url": info.get("webpage_url") or url,
        "thumbnail": _thumb(info),
    }

    if info.get("_type") == "playlist" or info.get("entries") is not None:
        entries = []
        for i, e in enumerate(info.get("entries") or [], start=1):
            if not e:
                continue
            entries.append({
                "index": i,
                "id": e.get("id"),
                "title": e.get("title") or f"Item {i}",
                "url": e.get("webpage_url") or e.get("url"),
                "duration": e.get("duration"),
                "thumbnail": _thumb(e),
                "has_video": bool(e.get("formats") is None or any(_is_video(f) for f in e.get("formats") or [])),
            })
        kind = "playlist" if platform == "youtube" or info.get("playlist_count", 0) > 20 else "carousel"
        return {**base, "kind": kind, "count": info.get("playlist_count") or len(entries), "entries": entries}

    duration = info.get("duration")
    formats = info.get("formats") or ([info] if info.get("url") else [])
    audio = audio_options(formats, duration)
    groups = video_groups(formats, duration, audio)
    has_audio = bool(audio) or any(v["muxed"] and v["audio_codec"] not in (None, "Unknown")
                                   for g in groups for v in g["variants"])
    return {
        **base,
        "kind": "single",
        "has_audio": has_audio,
        "duration": duration,
        "upload_date": _date(info.get("upload_date")),
        "live_status": info.get("live_status"),
        "aspect": aspect(info, groups, url),
        "video": groups,
        "audio": audio,
        "subtitles": subtitle_langs(info),
    }


# ----------------------------------------------------------------------------- selectors

class BadRequest(ValueError):
    pass


@dataclass
class Plan:
    format: str
    merge_output_format: str | None = None
    postprocessors: list[dict] = field(default_factory=list)
    extra: dict = field(default_factory=dict)
    strip_audio: bool = False
    to_gif: bool = False
    label: str | None = None


def _fid(v: str | None, name: str) -> str | None:
    if v is None:
        return None
    if not FORMAT_ID_RE.fullmatch(v):
        raise BadRequest(f"Invalid {name}.")
    return v


def drop_oversize(media: dict, max_bytes: int) -> dict:
    """On a server with a size cap, only offer what it will actually deliver."""
    def fits(size: dict | None) -> bool:
        b = (size or {}).get("bytes")
        return not b or b <= max_bytes * (1.25 if (size or {}).get("approx") else 1)

    groups = []
    for g in media.get("video") or []:
        vs = [v for v in g["variants"] if fits(v.get("size_av")) or fits(v.get("size_v"))]
        if vs:
            groups.append({**g, "variants": vs})
    for i, g in enumerate(groups):
        g["best"] = i == 0
    audio = [a for a in media.get("audio") or [] if fits(a.get("size"))]
    return {**media, "video": groups, "audio": audio} if "video" in media else media


def safe_plan(plan: Plan, mode: str | None) -> Plan:
    """A plan that almost always works: best available, in a container that holds any streams.
    Keeps conversions, subtitles, trim and GIF; only the format choice and container change."""
    if mode == "audio":
        fmt, merge = "ba/b", None
    elif mode == "video":
        fmt, merge = "bv*/b", None
    else:
        fmt, merge = "bv*+ba/b", "mp4"
    return replace(plan, format=fmt, merge_output_format=merge)


def build_plan(req: dict) -> Plan:
    """req: mode, format_id?, audio_id?, muxed?, container?, max_height?, compat, convert?, options"""
    mode = req.get("mode")
    if mode not in ("av", "video", "audio"):
        raise BadRequest("Unknown mode.")
    fid = _fid(req.get("format_id"), "format")
    aid = _fid(req.get("audio_id"), "audio format")
    compat = bool(req.get("compat"))
    h = req.get("max_height")
    if h is not None and (not isinstance(h, int) or not 1 <= h <= 8640):
        raise BadRequest("Invalid height.")
    hf = f"[height<={h}]" if h else ""
    opts = req.get("options") or {}
    plan: Plan

    if mode == "av":
        if fid and req.get("muxed"):
            fmt = f"{fid}/b{hf}"
        elif fid:
            pair = f"{fid}+{aid}/" if aid else ""
            fmt = f"{pair}{fid}+ba/b{hf}"
        elif compat:
            fmt = f"bv*[vcodec^=avc1]{hf}+ba[acodec^=mp4a]/b[ext=mp4]{hf}/bv*{hf}+ba/b"
        else:
            fmt = f"bv*{hf}+ba/b{hf}/b"
        container = req.get("container")
        if compat:
            merge = "mp4"
        elif container in ("mp4", "webm", "mkv"):
            # The chosen container first; yt-dlp moves on if it can't hold this pair of streams.
            # MP4 alone: yt-dlp would otherwise skip it for VP9 and fall to MKV, which phones can't play.
            merge = {"webm": "webm/mp4", "mp4": "mp4", "mkv": "mkv"}[container]
        else:
            merge = "mp4"
        plan = Plan(fmt, merge, label=None)
        if opts.get("gif"):
            plan.to_gif = True
    elif mode == "video":
        fmt = fid or (f"bv*[vcodec^=avc1]{hf}/bv*{hf}/b{hf}" if compat else f"bv*{hf}/b{hf}")
        plan = Plan(f"{fmt}/bv*/b", strip_audio=True)
        if opts.get("gif"):
            plan.to_gif = True
    else:
        fmt = f"{aid}/ba/b" if aid else "ba/b"
        conv = req.get("convert")
        pps: list[dict] = []
        if conv:
            codec = conv.get("codec")
            if codec not in CONVERT_CODECS:
                raise BadRequest("Unknown audio format.")
            br = conv.get("bitrate")
            if codec in ("mp3", "m4a", "opus"):
                if br is not None and br not in CONVERT_BITRATES:
                    raise BadRequest("Unsupported bitrate.")
                quality = str(br) if br else "0"
            else:
                quality = "0"
            pps.append({"key": "FFmpegExtractAudio", "preferredcodec": codec, "preferredquality": quality})
            out_codec = codec
        else:
            pps.append({"key": "FFmpegExtractAudio", "preferredcodec": "best"})
            out_codec = "best"
        if opts.get("embed_meta", True) and out_codec != "wav":
            pps.append({"key": "FFmpegMetadata", "add_metadata": True})
            pps.append({"key": "EmbedThumbnail", "already_have_thumbnail": False})
        plan = Plan(fmt, None, pps)
        if opts.get("embed_meta", True) and out_codec != "wav":
            plan.extra["writethumbnail"] = True

    # ---- shared options
    subs = opts.get("subtitles")
    if subs and mode != "audio":
        lang = subs.get("lang")
        if not lang or not LANG_RE.fullmatch(lang):
            raise BadRequest("Invalid subtitle language.")
        plan.extra.update({
            "writesubtitles": not subs.get("auto"),
            "writeautomaticsub": bool(subs.get("auto")),
            "subtitleslangs": [lang],
            "subtitlesformat": "srt/vtt/best",
        })
        plan.postprocessors.append({"key": "FFmpegSubtitlesConvertor", "format": "srt"})
        if subs.get("embed"):
            plan.postprocessors.append({"key": "FFmpegEmbedSubtitle"})
    if opts.get("thumbnail") and mode != "audio":
        plan.extra["writethumbnail"] = True
        plan.postprocessors.append({"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"})
    trim = opts.get("trim")
    if trim:
        try:
            start, end = float(trim["start"]), float(trim["end"])
        except (KeyError, TypeError, ValueError) as e:
            raise BadRequest("Invalid trim range.") from e
        if start < 0 or end <= start:
            raise BadRequest("The end of the trim has to be after the start.")
        plan.extra["trim"] = (start, end)
    return plan
