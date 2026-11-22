"""Dependency checks: ffmpeg, ffprobe, JS runtime (Node 22+ or Deno 2.3+), yt-dlp age."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from datetime import date
from functools import lru_cache
from pathlib import Path

STALE_DAYS = 14


def _extra_bin_dirs() -> list[Path]:
    dirs = []
    if os.environ.get("YTDOWN_FFMPEG_DIR"):
        dirs.append(Path(os.environ["YTDOWN_FFMPEG_DIR"]))
    local = os.environ.get("LOCALAPPDATA")
    if local:
        dirs.append(Path(local) / "Microsoft" / "WinGet" / "Links")
        # winget may add the package's bin folder to PATH instead of Links
        dirs += sorted((Path(local) / "Microsoft" / "WinGet" / "Packages").glob("*FFmpeg*/*/bin"))
    dirs += _registry_path_dirs()
    dirs += [Path("/opt/homebrew/bin"), Path("/usr/local/bin"), Path("/usr/bin")]
    return dirs


def _registry_path_dirs() -> list[Path]:
    """Fresh installs update PATH in the registry, not in already-running processes."""
    if os.name != "nt":
        return []
    try:
        import winreg
    except ImportError:
        return []
    out: list[Path] = []
    for root, key in ((winreg.HKEY_CURRENT_USER, r"Environment"),
                      (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")):
        try:
            with winreg.OpenKey(root, key) as k:
                val, _ = winreg.QueryValueEx(k, "Path")
        except OSError:
            continue
        out += [Path(os.path.expandvars(p)) for p in str(val).split(";") if p.strip()]
    return out


def which(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    for d in _extra_bin_dirs():
        for cand in (d / name, d / f"{name}.exe"):
            if cand.exists():
                return str(cand)
    return None


def _version(cmd: list[str]) -> str | None:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=10,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", (out.stdout or "") + (out.stderr or ""))
    return m.group(0) if m else None


def _major_minor(v: str | None) -> tuple[int, int]:
    if not v:
        return (0, 0)
    p = v.split(".")
    return (int(p[0]), int(p[1]) if len(p) > 1 else 0)


def engine_version() -> str:
    from yt_dlp.version import __version__
    return __version__


def engine_age_days(version: str | None = None, today: date | None = None) -> int | None:
    v = version or engine_version()
    m = re.match(r"(\d{4})\.(\d{1,2})\.(\d{1,2})", v)
    if not m:
        return None
    released = date(int(m[1]), int(m[2]), int(m[3]))
    return ((today or date.today()) - released).days


def is_nightly(version: str | None = None) -> bool:
    return len((version or engine_version()).split(".")) > 3


@lru_cache(maxsize=1)
def tools() -> dict:
    ffmpeg = which("ffmpeg")
    ffprobe = which("ffprobe")
    node = which("node")
    deno = which("deno")
    node_v = _version([node, "--version"]) if node else None
    deno_v = _version([deno, "--version"]) if deno else None
    return {
        "ffmpeg": {"path": ffmpeg, "version": _version([ffmpeg, "-version"]) if ffmpeg else None},
        "ffprobe": {"path": ffprobe},
        "node": {"path": node, "version": node_v, "ok": _major_minor(node_v) >= (22, 0)},
        "deno": {"path": deno, "version": deno_v, "ok": _major_minor(deno_v) >= (2, 3)},
    }


def js_runtimes() -> dict:
    t = tools()
    rt = {}
    if t["node"]["ok"]:
        rt["node"] = {"path": t["node"]["path"]}
    if t["deno"]["ok"]:
        rt["deno"] = {"path": t["deno"]["path"]}
    return rt


def ffmpeg_location() -> str | None:
    p = tools()["ffmpeg"]["path"]
    return str(Path(p).parent) if p else None


def report() -> dict:
    t = tools()
    v = engine_version()
    age = engine_age_days(v)
    try:
        from importlib.metadata import version as pkg_version
        ejs = pkg_version("yt-dlp-ejs")
    except Exception:  # noqa: BLE001 - optional package
        ejs = None
    js_ok = t["node"]["ok"] or t["deno"]["ok"]
    problems = []
    if not t["ffmpeg"]["path"]:
        problems.append({"code": "ffmpeg", "text": "ffmpeg isn't installed, so files can't be merged or converted."})
    if not t["ffprobe"]["path"]:
        problems.append({"code": "ffprobe", "text": "ffprobe isn't installed."})
    if not js_ok:
        problems.append({"code": "js", "text": "No JavaScript runtime found. Install Node 22+ (or Deno 2.3+) for full YouTube support."})
    if not ejs:
        problems.append({"code": "ejs", "text": "yt-dlp-ejs is missing. Update the engine to install it."})
    stale = age is not None and age > STALE_DAYS
    return {
        "ok": not problems,
        "engine": {"version": v, "age_days": age, "stale": stale,
                   "channel": "nightly" if is_nightly(v) else "stable", "ejs": ejs},
        "tools": {k: {kk: vv for kk, vv in d.items() if kk != "path"} | {"found": bool(d["path"])}
                  for k, d in t.items()},
        "problems": problems,
        "python": sys.version.split()[0],
    }


def update_engine(channel: str) -> dict:
    """pip-install the newest yt-dlp (+ its pinned ejs). Arguments are a fixed list, never a shell string."""
    cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "--disable-pip-version-check"]
    if channel == "nightly":
        cmd.append("--pre")
    cmd.append("yt-dlp[default]")
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600,
                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    tail = (proc.stdout + proc.stderr)[-2000:]
    return {"ok": proc.returncode == 0, "log": tail}
