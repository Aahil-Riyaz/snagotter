"""Safe, readable filenames and RFC 5987 Content-Disposition headers."""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import quote

MAX_BYTES = 180  # leaves room for the extension and the OS path limit
_BAD = re.compile(r'[/\\:*?"<>|\x00-\x1f\x7f]')
_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
# Characters that must not be left dangling at a cut point.
_JOINERS = {"‍", "️", "︎", "⃣"}
_EXT = re.compile(r"^[a-z0-9]{1,5}$")


def _clean(part: str) -> str:
    s = unicodedata.normalize("NFC", part or "")
    s = _BAD.sub(" ", s)
    # Bidi controls can disguise extensions ("gpj.exe"); drop them.
    s = re.sub(r"[‪-‮⁦-⁩‎‏]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _cut(s: str, limit: int) -> str:
    if len(s.encode("utf-8")) <= limit:
        return s
    out = ""
    for ch in s:
        if len((out + ch).encode("utf-8")) > limit - 1:  # room for the ellipsis' first byte
            break
        out += ch
    # Don't leave half an emoji sequence or a combining mark behind.
    while out and (out[-1] in _JOINERS or unicodedata.combining(out[-1])
                   or 0x1F3FB <= ord(out[-1]) <= 0x1F3FF):
        out = out[:-1]
    while out and out[-1] in _JOINERS:
        out = out[:-1]
    out = out.rstrip(" .-—")
    while len((out + "…").encode("utf-8")) > limit:
        out = out[:-1]
    return out + "…"


def build_filename(title: str | None, uploader: str | None, label: str | None, ext: str) -> str:
    """'Title — Uploader (1080p).mp4', sanitised and length-capped (UTF-8 bytes)."""
    ext = (ext or "bin").lower().lstrip(".")
    if not _EXT.match(ext):
        ext = "bin"
    t = _clean(title or "") or "download"
    u = _clean(uploader or "")
    suffix = f" ({_clean(label)})" if label else ""
    head = t if not u or u.lower() in t.lower() else f"{t} — {u}"
    budget = MAX_BYTES - len(suffix.encode("utf-8"))
    name = _cut(head, budget) + suffix
    name = name.rstrip(" .")  # Windows strips these silently
    if name.split(".")[0].upper() in _RESERVED:
        name = "_" + name
    return f"{name}.{ext}"


def content_disposition(filename: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", filename).encode("ascii", "ignore").decode()
    ascii_name = re.sub(r'[^A-Za-z0-9 ._()\-\[\]]', "_", ascii_name).strip() or "download"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename, safe='')}"
