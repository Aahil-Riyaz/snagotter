"""Integration probe: run one real download through the live API and verify it with ffprobe.

usage: python scripts/probe.py URL MODE [--compat] [--item N] [--cancel]
MODE is one of: best, lower, video, audio, mp3, gif
Prints one JSON line with the result, for docs/test-log.md.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ytdown_engine import doctor  # noqa: E402

API = "http://127.0.0.1:8787"


def ffprobe(path: Path) -> dict:
    exe = doctor.which("ffprobe")
    out = subprocess.run([exe, "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,height",
                          "-of", "json", str(path)], capture_output=True, text=True, check=True)
    data = json.loads(out.stdout)
    streams = data.get("streams", [])
    return {
        "duration": round(float(data.get("format", {}).get("duration") or 0), 1),
        "video": [s["codec_name"] for s in streams if s["codec_type"] == "video" and s["codec_name"] not in ("mjpeg", "png")],
        "audio": [s["codec_name"] for s in streams if s["codec_type"] == "audio"],
        "height": next((s.get("height") for s in streams if s["codec_type"] == "video"), None),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("mode", choices=["best", "lower", "video", "audio", "mp3", "gif"])
    ap.add_argument("--compat", action="store_true")
    ap.add_argument("--item", type=int)
    ap.add_argument("--cancel", action="store_true")
    a = ap.parse_args()
    t0 = time.time()
    c = httpx.Client(base_url=API, timeout=180)
    r = c.post("/api/info", json={"url": a.url})
    if r.status_code != 200:
        print(json.dumps({"url": a.url, "mode": a.mode, "ok": False, "stage": "info", "error": r.json().get("error")},
                         ensure_ascii=False))
        return 1
    m = r.json()
    req: dict = {"url": m["url"], "mode": "av", "compat": a.compat}
    expect_video, expect_audio = True, True
    duration = m.get("duration")
    groups = m.get("video") or []
    if m["kind"] != "single":
        idx = a.item or 1
        entry = m["entries"][idx - 1]
        duration = entry.get("duration")
        if m["kind"] == "carousel":
            req["items"] = idx
        else:
            req["url"] = entry["url"]
        groups = []
    if a.mode in ("best", "lower") and groups:
        g = groups[0] if a.mode == "best" else groups[min(len(groups) - 1, 2)]
        v = next((x for x in g["variants"] if x["codec"] == "H.264"), g["variants"][0]) if a.compat else g["variants"][0]
        req.update(format_id=v["format_id"], audio_id=v["audio_id"], muxed=v["muxed"], container=v["container"])
        expect_audio = bool(v["muxed"] and v["audio_codec"]) or bool(v["audio_id"])
    elif a.mode in ("best", "lower"):
        req["max_height"] = 720 if a.mode == "lower" else None
    elif a.mode == "video":
        req["mode"] = "video"
        if groups:
            req["format_id"] = groups[0]["variants"][0]["format_id"]
        expect_audio = False
    elif a.mode == "gif":
        req["options"] = {"gif": True}
        expect_audio = False
    else:
        req["mode"] = "audio"
        expect_video = False
        if a.mode == "mp3":
            req["convert"] = {"codec": "mp3", "bitrate": 320}
    r = c.post("/api/jobs", json=req)
    if r.status_code != 201:
        print(json.dumps({"url": a.url, "mode": a.mode, "ok": False, "stage": "create", "error": r.text[:500]}))
        return 1
    jid = r.json()["job_id"]
    seen: list[str] = []
    events = 0
    snap: dict = {}
    with c.stream("GET", f"/api/jobs/{jid}/events", timeout=None) as s:
        for line in s.iter_lines():
            if not line.startswith("data: "):
                continue
            snap = json.loads(line[6:])
            events += 1
            if snap["status"] not in seen:
                seen.append(snap["status"])
            if a.cancel and snap["status"].startswith("downloading") and (snap.get("percent") or 0) > 5:
                c.delete(f"/api/jobs/{jid}")
            if snap["status"] in ("ready", "failed", "cancelled"):
                break
    res = {"url": a.url, "mode": a.mode, "platform": m["platform"], "kind": m["kind"], "title": m.get("title"),
           "stages": seen, "events": events, "seconds": round(time.time() - t0, 1)}
    if a.cancel:
        ok = snap["status"] == "cancelled"
        print(json.dumps({**res, "ok": ok, "status": snap["status"]}, ensure_ascii=False))
        return 0 if ok else 1
    if snap.get("status") != "ready":
        print(json.dumps({**res, "ok": False, "stage": "download", "error": snap.get("error")}, ensure_ascii=False))
        return 1
    tmp = Path(tempfile.mkdtemp(prefix="ytdown-probe-"))
    with c.stream("GET", f"/api/jobs/{jid}/file") as f:
        cd = f.headers.get("content-disposition", "")
        ctype = f.headers.get("content-type")
        out = tmp / "out.bin"
        with open(out, "wb") as fh:
            for chunk in f.iter_bytes():
                fh.write(chunk)
    probe = ffprobe(out)
    if m["kind"] == "carousel" and a.mode not in ("audio", "mp3"):
        expect_audio = bool(probe["audio"])  # carousel items may be silent; we only check video here
    ok = bool(probe["video"]) == expect_video and bool(probe["audio"]) == expect_audio
    if duration and a.mode != "gif":
        ok = ok and abs(probe["duration"] - duration) <= max(2.0, duration * 0.02)
    print(json.dumps({**res, "ok": ok, "file": snap["filename"], "bytes": out.stat().st_size, "content_type": ctype,
                      "disposition_utf8": "filename*=UTF-8''" in cd, "probe": probe, "expected_duration": duration},
                     ensure_ascii=False))
    out.unlink(missing_ok=True)
    tmp.rmdir()
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
