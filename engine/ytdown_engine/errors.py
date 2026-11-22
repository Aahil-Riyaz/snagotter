"""Map raw yt-dlp / engine errors to plain-language states with one next action."""
from __future__ import annotations

import re

# code -> (title, what to do next, action id, action label)
CATALOG: dict[str, tuple[str, str, str | None, str | None]] = {
    "unavailable": ("This video isn't available.",
                    "It may be private, removed, or the link is wrong. Check the link in your browser.",
                    "open_link", "Open the link"),
    "login_required": ("This one needs you to be signed in.",
                       "It's age-restricted or only visible to logged-in users. Use your own browser cookies so the engine sees what you see.",
                       "cookies", "Use my cookies"),
    "region_locked": ("This video isn't available in your region.",
                      "The uploader limited where it can be watched. There's nothing the engine can do about that.",
                      "open_link", "Open the link"),
    "live_in_progress": ("This is still live.",
                         "Live streams can be saved once they finish. Try again after the broadcast ends.",
                         "retry", "Try again"),
    "unsupported": ("There's no video or audio here.",
                    "The link works, but the engine couldn't find media on that page. Photo-only posts aren't supported.",
                    "clear", "Paste another link"),
    "rate_limited": ("The site is asking to confirm you're not a bot.",
                     "This happens after many requests or on some networks. Wait a few minutes, or use your own browser cookies.",
                     "cookies", "Use my cookies"),
    "server_blocked": ("This site blocks downloads from this server.",
                       "YouTube and TikTok refuse most cloud servers. Other sites work here. For this one, run ytdown on your own computer: it's free and the README has a one-line setup.",
                       None, None),
    "network": ("Couldn't reach the site.",
                "Check your internet connection, then try again.",
                "retry", "Try again"),
    "engine_outdated": ("The download engine is out of date.",
                        "Sites change often. Updating the engine usually fixes this.",
                        "update", "Update engine"),
    "dependency_missing": ("Part of the engine is missing.",
                           "ffmpeg or a JavaScript runtime (Node 22+ or Deno) isn't installed. The README has one-line install commands.",
                           "doctor", "See what's missing"),
    "no_audio": ("There's no sound to save.",
                 "This post has no audio track. Pick Video + audio or Video only instead.",
                 None, None),
    "invalid_url": ("That doesn't look like a link.",
                    "Paste a full link, like https://youtube.com/watch?v=…",
                    "clear", "Paste another link"),
    "blocked_url": ("That link points to a private network.",
                    "Only public websites can be fetched.",
                    "clear", "Paste another link"),
    "too_large": ("This is bigger than the limit on this server.",
                  "Pick a lower quality, or run ytdown on your own computer.",
                  None, None),
    "disk_full": ("There isn't enough space for this download.",
                  "Finish or clear other downloads, then try again.",
                  "retry", "Try again"),
    "cancelled": ("Download cancelled.", "Partial files were deleted.", None, None),
    "engine_offline": ("Can't reach the engine.",
                       "Start ytdown on your computer, then try again.",
                       "retry", "Try again"),
    "unknown": ("Something went wrong.",
                "Try again. If it keeps happening, update the engine.",
                "retry", "Try again"),
}

_RULES: list[tuple[str, re.Pattern]] = [
    ("no_audio", re.compile(r"unable to obtain file audio codec|does not contain any (audio )?stream", re.I)),
    ("dependency_missing", re.compile(r"ffmpeg (is )?not (found|installed)|ffprobe.*not found|no (supported )?javascript runtime|js runtime|requires ffmpeg", re.I)),
    ("live_in_progress", re.compile(r"is live|live event will begin|premieres in|this live event|is_upcoming|live stream is offline|not yet started", re.I)),
    ("rate_limited", re.compile(r"not a bot|http error 429|too many requests|rate.?limit|confirm you.?re not", re.I)),
    ("login_required", re.compile(r"sign in to confirm your age|age.?restrict|login required|log in|requires authentication|use --cookies|cookies.*(needed|required)|inappropriate for some users|members.?only|join this channel|private account", re.I)),
    ("region_locked", re.compile(r"available in your (country|region|location)|geo.?restrict|blocked it in your country|ip address is blocked from accessing", re.I)),
    ("unavailable", re.compile(r"private video|video (is )?unavailable|this video is no longer|has been removed|does not exist|no longer available|account.*terminated|http error 404|not found|post (was|has been) deleted|this content isn.?t available", re.I)),
    ("unsupported", re.compile(r"unsupported url|does not have an? \w+ tab|no video formats found|there is no video|no media found|no video could be found|requested format is not available", re.I)),
    ("too_large", re.compile(r"file is larger than max-filesize|larger than max|exceeds the maximum", re.I)),
    ("network", re.compile(r"unable to download webpage|timed out|connection (reset|refused|aborted)|getaddrinfo|name or service not known|network is unreachable|temporary failure in name resolution|ssl|remote end closed", re.I)),
    ("disk_full", re.compile(r"no space left|disk full|errno 28", re.I)),
]

_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def classify(message: str | None, engine_age_days: int | None = None) -> str:
    msg = _ANSI.sub("", message or "")
    for code, rx in _RULES:
        if rx.search(msg):
            return code
    if engine_age_days is not None and engine_age_days > 14:
        return "engine_outdated"
    return "unknown"


def to_payload(code: str, details: str | None = None) -> dict:
    title, hint, action, label = CATALOG.get(code, CATALOG["unknown"])
    clean = _ANSI.sub("", details or "").strip() or None
    if clean:
        clean = re.sub(r"(cookie|authorization|token)[=:]\s*\S+", r"\1=[hidden]", clean, flags=re.I)
        clean = re.sub(r"(\w+://)[^/\s:@]+:[^/\s@]+@", r"\1[hidden]@", clean)  # proxy credentials
    return {"code": code, "title": title, "hint": hint, "action": action, "action_label": label,
            "details": clean[:4000] if clean else None}


_SERVER_BLOCK = re.compile(r"\[tiktok\].*unexpected response from webpage", re.I | re.S)


def from_exception(exc: BaseException, engine_age_days: int | None = None, hosted: bool = False) -> dict:
    text = str(exc)
    code = classify(text, engine_age_days)
    # On a cloud server, YouTube's bot check and TikTok's empty pages mean the site refuses
    # the server's address. Waiting won't help and cookies are off, so say so plainly.
    if hosted and (code == "rate_limited" or (code in ("unknown", "engine_outdated") and _SERVER_BLOCK.search(text))):
        code = "server_blocked"
    return to_payload(code, text)
