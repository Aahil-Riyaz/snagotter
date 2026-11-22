"""URL normalisation, platform detection, batch splitting and SSRF checks."""
from __future__ import annotations

import ipaddress
import re
import socket
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

PLATFORMS = ("youtube", "instagram", "tiktok", "x", "other")

_YT_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
             "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com"}
_IG_HOSTS = {"instagram.com", "www.instagram.com", "m.instagram.com"}
_TT_HOSTS = {"tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"}
_X_HOSTS = {"x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com",
            "mobile.x.com", "fxtwitter.com", "vxtwitter.com", "fixupx.com", "fixvx.com",
            "www.fxtwitter.com", "www.vxtwitter.com"}

# Tracking parameters removed everywhere.
_TRACKING = {"si", "igsh", "igshid", "fbclid", "gclid", "feature", "pp", "ref_src", "ref_url",
             "is_from_webapp", "sender_device", "sender_web_id", "_r", "_t", "share_app_id",
             "share_link_id", "embed_source", "mibextid"}
# "t" is a timestamp on YouTube (kept) but a share token on X (dropped); "s" is X share junk.
_TRACKING_X = {"t", "s"}

_URL_RE = re.compile(r"^(?:https?://\S+|(?:[\w-]+\.)+[a-z]{2,}(?:/\S*)?)$", re.I)


class InvalidUrl(ValueError):
    pass


class BlockedUrl(ValueError):
    pass


def _host(url: str) -> str:
    try:
        return (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


def detect_platform(url: str) -> str:
    h = _host(url if "://" in url else "https://" + url)
    if h in _YT_HOSTS or h.endswith(".youtube.com"):
        return "youtube"
    if h in _IG_HOSTS:
        return "instagram"
    if h in _TT_HOSTS or h.endswith(".tiktok.com"):
        return "tiktok"
    if h in _X_HOSTS:
        return "x"
    return "other"


def normalize(raw: str) -> str:
    """Trim, add a scheme, canonicalise mirror hosts and strip tracking params."""
    s = (raw or "").strip().strip("<>\"'")
    if not s:
        raise InvalidUrl("Paste a link first.")
    if not re.match(r"^[a-z][a-z0-9+.-]*://", s, re.I):
        s = "https://" + s
    try:
        parts = urlsplit(s)
        port = parts.port
    except ValueError as e:
        raise InvalidUrl("That doesn't look like a link.") from e
    if parts.scheme.lower() not in ("http", "https"):
        raise InvalidUrl("Only http and https links work.")
    host = (parts.hostname or "").lower()
    if not host or ("." not in host and host != "localhost") or " " in host:
        raise InvalidUrl("That doesn't look like a link.")

    netloc = host + (f":{port}" if port else "")
    platform = detect_platform(s)
    if platform == "x":
        netloc = "x.com"
    elif platform == "youtube" and host in ("m.youtube.com", "youtube.com"):
        netloc = "www.youtube.com"
    elif platform == "instagram":
        netloc = "www.instagram.com"

    drop = _TRACKING | (_TRACKING_X if platform == "x" else set())
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=False)
             if k.lower() not in drop and not k.lower().startswith("utm_")]
    return urlunsplit((parts.scheme.lower(), netloc, parts.path or "/", urlencode(query), ""))


def split_batch(text: str) -> list[str]:
    """Split pasted text into unique links (newline, space or comma separated)."""
    out: list[str] = []
    for token in re.split(r"[\s,]+", text or ""):
        token = token.strip()
        if not token or not _URL_RE.match(token):
            continue
        try:
            n = normalize(token)
        except InvalidUrl:
            continue
        if n not in out:
            out.append(n)
    return out


def youtube_playlist_choice(url: str) -> dict | None:
    """For watch?v=X&list=Y return both options so the UI can ask which one."""
    if detect_platform(url) != "youtube":
        return None
    p = urlsplit(url)
    q = dict(parse_qsl(p.query))
    if "v" in q and "list" in q and not q["list"].startswith(("RD", "UL")):  # RD/UL = endless mixes
        return {
            "video_url": urlunsplit((p.scheme, p.netloc, "/watch", urlencode({"v": q["v"]}), "")),
            "playlist_url": urlunsplit((p.scheme, p.netloc, "/playlist", urlencode({"list": q["list"]}), "")),
        }
    return None


def _is_public_ip(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return not (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved
                or addr.is_multicast or addr.is_unspecified)


def assert_public(url: str, resolver=socket.getaddrinfo) -> None:
    """SSRF guard: http/https only, and every resolved address must be public."""
    p = urlsplit(url)
    if p.scheme not in ("http", "https"):
        raise BlockedUrl("Only http and https links work.")
    host = p.hostname
    if not host:
        raise BlockedUrl("That link has no host.")
    try:
        infos = resolver(host, p.port or (443 if p.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise InvalidUrl(f"Couldn't find {host}. Check the link, or your connection.") from e
    ips = {i[4][0] for i in infos}
    if not ips or not all(_is_public_ip(ip.split("%")[0]) for ip in ips):
        raise BlockedUrl("Links to private or local network addresses are blocked.")
