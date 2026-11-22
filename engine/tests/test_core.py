import json
import socket
from pathlib import Path

import pytest

from ytdown_engine import errors, formats, names, urls

FIX = Path(__file__).parent / "fixtures"


# ------------------------------------------------------------------------- URLs

@pytest.mark.parametrize("raw,expected", [
    ("  https://youtu.be/aqz-KE-bpKQ?si=abc123  ", "https://youtu.be/aqz-KE-bpKQ"),
    ("youtube.com/watch?v=aqz-KE-bpKQ&t=42&si=x", "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=42"),
    ("https://m.youtube.com/watch?v=abc&list=PL1&utm_source=x", "https://www.youtube.com/watch?v=abc&list=PL1"),
    ("https://www.instagram.com/reel/C1x/?igsh=MWQ1ZGUx", "https://www.instagram.com/reel/C1x/"),
    ("https://fxtwitter.com/NASA/status/1?s=20&t=abc", "https://x.com/NASA/status/1"),
    ("https://mobile.twitter.com/NASA/status/1", "https://x.com/NASA/status/1"),
    ("https://www.tiktok.com/@nasa/video/7?is_from_webapp=1&sender_device=pc", "https://www.tiktok.com/@nasa/video/7"),
    ("https://music.youtube.com/watch?v=abc&feature=share", "https://music.youtube.com/watch?v=abc"),
])
def test_normalize(raw, expected):
    assert urls.normalize(raw) == expected


@pytest.mark.parametrize("raw", ["", "   ", "ftp://example.com/a", "javascript:alert(1)", "not a link", "http://"])
def test_normalize_rejects(raw):
    with pytest.raises(urls.InvalidUrl):
        urls.normalize(raw)


@pytest.mark.parametrize("url,platform", [
    ("https://youtu.be/x", "youtube"), ("https://www.youtube.com/shorts/x", "youtube"),
    ("https://music.youtube.com/watch?v=x", "youtube"), ("https://www.youtube-nocookie.com/embed/x", "youtube"),
    ("https://www.instagram.com/p/x/", "instagram"), ("https://vm.tiktok.com/ZM/", "tiktok"),
    ("https://vt.tiktok.com/ZS/", "tiktok"), ("https://twitter.com/a/status/1", "x"),
    ("https://vxtwitter.com/a/status/1", "x"), ("https://vimeo.com/1", "other"),
])
def test_detect_platform(url, platform):
    assert urls.detect_platform(url) == platform


def test_split_batch_dedupes_and_ignores_noise():
    text = "https://youtu.be/a\n  youtu.be/a?si=1  https://x.com/a/status/1, hello\nhttps://vimeo.com/2"
    assert urls.split_batch(text) == ["https://youtu.be/a", "https://x.com/a/status/1", "https://vimeo.com/2"]


def test_playlist_choice():
    c = urls.youtube_playlist_choice("https://www.youtube.com/watch?v=abc&list=PLxyz")
    assert c == {"video_url": "https://www.youtube.com/watch?v=abc",
                 "playlist_url": "https://www.youtube.com/playlist?list=PLxyz"}
    assert urls.youtube_playlist_choice("https://www.youtube.com/watch?v=abc&list=RDabc") is None
    assert urls.youtube_playlist_choice("https://www.youtube.com/watch?v=abc") is None


def _resolver(ip):
    return lambda host, port, proto=0: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]


@pytest.mark.parametrize("ip", ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1"])
def test_ssrf_blocks_private(ip):
    with pytest.raises(urls.BlockedUrl):
        urls.assert_public("http://example.com/x", resolver=_resolver(ip))


def test_ssrf_allows_public():
    urls.assert_public("https://example.com/x", resolver=_resolver("93.184.215.14"))


# ------------------------------------------------------------------------- formats

@pytest.fixture(scope="module")
def bbb():
    info = json.loads((FIX / "youtube_bbb.json").read_text())
    return formats.build_media(info, "https://www.youtube.com/watch?v=aqz-KE-bpKQ")


def test_media_basics(bbb):
    assert bbb["kind"] == "single"
    assert bbb["platform"] == "youtube"
    assert bbb["aspect"] == "16:9"
    assert bbb["upload_date"] and len(bbb["upload_date"]) == 10


def test_groups_sorted_best_first(bbb):
    heights = [(g["height"], g["fps"]) for g in bbb["video"]]
    assert heights == sorted(heights, reverse=True)
    assert bbb["video"][0]["label"] == "4K" and bbb["video"][0]["best"] is True
    assert [g["best"] for g in bbb["video"]].count(True) == 1
    assert "2K" in {g["label"] for g in bbb["video"]}


def test_no_duplicates_or_storyboards(bbb):
    for g in bbb["video"]:
        codecs = [v["codec"] for v in g["variants"]]
        assert len(codecs) == len(set(codecs)), g["key"]
        for v in g["variants"]:
            assert not v["format_id"].startswith("sb")


def test_1080p60_has_three_codecs_with_real_sizes(bbb):
    g = next(g for g in bbb["video"] if g["key"] == "1080p60")
    assert [v["codec"] for v in g["variants"]] == ["AV1", "VP9", "H.264"]
    h264 = g["variants"][-1]
    assert h264["format_id"] == "299"            # https preferred over the m3u8 copy (312)
    assert h264["audio_codec"] == "AAC" and h264["container"] == "mp4"
    assert h264["size_v"]["approx"] is False
    assert h264["size_av"]["bytes"] > h264["size_v"]["bytes"]
    vp9 = g["variants"][1]
    assert vp9["audio_codec"] == "Opus" and vp9["container"] == "webm"


def test_audio_options(bbb):
    a = bbb["audio"]
    assert a[0]["codec"] in ("Opus", "AAC")
    assert all(x["codec"] in formats.AUDIO_KEEP for x in a)
    assert not any(x["format_id"].endswith("-drc") for x in a)
    stereo = [x for x in a if not x["surround"]]
    assert a[:len(stereo)] == stereo                      # stereo tracks come first
    assert [x["abr"] for x in stereo] == sorted([x["abr"] for x in stereo], reverse=True)
    assert a[0]["format_id"] == "251"                     # Opus 129 kbps stereo, not the 5.1 AAC


def test_companion_audio_is_stereo(bbb):
    g = next(g for g in bbb["video"] if g["key"] == "1080p60")
    assert {v["codec"]: v["audio_id"] for v in g["variants"]} == {"AV1": "251", "VP9": "251", "H.264": "140"}


def test_size_estimate_marked_approx():
    s = formats.format_size({"tbr": 1000}, 60)
    assert s.bytes == 1000 * 125 * 60 and s.approx
    assert formats.format_size({}, 60).bytes is None


def test_watermark_variant_ranked_last():
    info = {"id": "1", "title": "t", "duration": 10, "webpage_url": "https://www.tiktok.com/@a/video/1",
            "formats": [
                {"format_id": "download", "vcodec": "h264", "acodec": "aac", "height": 1024, "width": 576,
                 "format_note": "Download video, watermarked", "tbr": 2000, "ext": "mp4"},
                {"format_id": "play-0", "vcodec": "h265", "acodec": "aac", "height": 1024, "width": 576,
                 "tbr": 1500, "ext": "mp4"},
            ]}
    m = formats.build_media(info, info["webpage_url"])
    assert m["aspect"] == "9:16"
    vs = m["video"][0]["variants"]
    assert vs[0]["watermarked"] is False and vs[-1]["watermarked"] is True


def test_playlist_entries():
    info = {"_type": "playlist", "id": "PL", "title": "List", "webpage_url": "https://www.youtube.com/playlist?list=PL",
            "entries": [{"id": "a", "title": "A", "url": "https://www.youtube.com/watch?v=a", "duration": 5}, None]}
    m = formats.build_media(info, info["webpage_url"])
    assert m["kind"] == "playlist" and m["entries"][0]["index"] == 1 and len(m["entries"]) == 1


def test_plan_av_selected_pair():
    p = formats.build_plan({"mode": "av", "format_id": "299", "audio_id": "140", "container": "mp4"})
    assert p.format.startswith("299+140/") and p.merge_output_format == "mp4"


def test_plan_compat_forces_mp4():
    p = formats.build_plan({"mode": "av", "compat": True, "max_height": 720})
    assert "[vcodec^=avc1][height<=720]" in p.format and p.merge_output_format == "mp4"


def test_plan_audio_original_and_convert():
    p = formats.build_plan({"mode": "audio"})
    assert p.postprocessors[0] == {"key": "FFmpegExtractAudio", "preferredcodec": "best"}
    p = formats.build_plan({"mode": "audio", "convert": {"codec": "mp3", "bitrate": 320}})
    assert p.postprocessors[0]["preferredquality"] == "320"
    p = formats.build_plan({"mode": "audio", "convert": {"codec": "wav"}})
    assert all(pp["key"] != "EmbedThumbnail" for pp in p.postprocessors)


@pytest.mark.parametrize("bad", [
    {"mode": "nope"}, {"mode": "av", "format_id": "299; rm -rf /"}, {"mode": "av", "format_id": "a+b"},
    {"mode": "audio", "convert": {"codec": "exe"}}, {"mode": "audio", "convert": {"codec": "mp3", "bitrate": 999}},
    {"mode": "av", "options": {"trim": {"start": 10, "end": 5}}},
    {"mode": "av", "options": {"subtitles": {"lang": "../../etc"}}},
])
def test_plan_rejects(bad):
    with pytest.raises(formats.BadRequest):
        formats.build_plan(bad)


def test_plan_video_only_strips_audio():
    p = formats.build_plan({"mode": "video", "format_id": "299"})
    assert p.strip_audio and p.format.startswith("299")


# ------------------------------------------------------------------------- filenames

def test_filename_basic():
    assert names.build_filename("Big Buck Bunny", "Blender", "1080p", "mp4") == "Big Buck Bunny — Blender (1080p).mp4"


def test_filename_strips_forbidden():
    n = names.build_filename('a/b\\c:d*e?f"g<h>i|j', None, None, "mp3")
    assert not any(c in n[:-4] for c in '/\\:*?"<>|')


def test_filename_uploader_already_in_title():
    assert names.build_filename("Blender: Big Buck Bunny", "Blender", None, "mp4") == "Blender Big Buck Bunny.mp4"


def test_filename_caps_length_and_keeps_utf8_valid():
    n = names.build_filename("🎬" * 200 + "👨‍👩‍👧", "x", "4K", "mp4")
    assert len(n.encode("utf-8")) <= names.MAX_BYTES + 5
    n.encode("utf-8")  # no lone surrogates
    assert not n.split(" (4K)")[0].rstrip("…").endswith("‍")


def test_filename_arabic_and_reserved():
    assert names.build_filename("مرحبا بالعالم", "قناة", "720p", "mp4").startswith("مرحبا")
    assert names.build_filename("CON", None, None, "mp4").startswith("_")
    assert "‮" not in names.build_filename("title‮gpj", None, None, "mp4")


def test_filename_bad_extension():
    assert names.build_filename("a", None, None, "../../x").endswith(".bin")


def test_content_disposition_rfc5987():
    h = names.content_disposition("Café — 東京 (1080p).mp4")
    assert h.startswith('attachment; filename="')
    assert "filename*=UTF-8''Caf%C3%A9%20%E2%80%94%20%E6%9D%B1%E4%BA%AC%20%281080p%29.mp4" in h
    assert "\n" not in h and '"' not in h.split('filename="')[1].split('"')[0]


# ------------------------------------------------------------------------- errors

@pytest.mark.parametrize("msg,code", [
    ("ERROR: [youtube] abc: Private video. Sign in if you've been granted access", "unavailable"),
    ("ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader", "unavailable"),
    ("ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.", "login_required"),
    ("ERROR: [Instagram] x: Requested content is not available, rate-limit reached or login required", "rate_limited"),
    ("ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser", "rate_limited"),
    ("ERROR: [youtube] abc: The uploader has not made this video available in your country", "region_locked"),
    ("ERROR: [youtube] abc: This live event will begin in 3 hours.", "live_in_progress"),
    ("ERROR: Unsupported URL: https://example.com/", "unsupported"),
    ("ERROR: [twitter] 1: No video could be found in this tweet", "unsupported"),
    ("ERROR: Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>", "network"),
    ("ERROR: Postprocessing: ffmpeg not found. Please install or provide the path", "dependency_missing"),
    ("ERROR: HTTP Error 429: Too Many Requests", "rate_limited"),
    ("ERROR: [youtube] xxxxxxxxxxx: This video is unavailable", "unavailable"),
    ("ERROR: [TikTok] 7107: Your IP address is blocked from accessing this post", "region_locked"),
    ("ERROR: [youtube:tab] @Blender: This channel does not have a shorts tab", "unsupported"),
    ("ERROR: Unsupported URL: https://www.tiktok.com/?_r=1", "unsupported"),
])
def test_classify(msg, code):
    assert errors.classify(msg) == code


def test_classify_unknown_falls_back_to_outdated_when_old():
    assert errors.classify("weird extractor error", engine_age_days=40) == "engine_outdated"
    assert errors.classify("weird extractor error", engine_age_days=3) == "unknown"


def test_payload_has_one_action_and_hides_secrets():
    p = errors.to_payload("login_required", "cookie=SECRET123 failed")
    assert p["action"] == "cookies" and p["action_label"]
    assert "SECRET123" not in p["details"]


def test_vertical_labels_use_short_side():
    info = {"id": "s", "title": "t", "duration": 14, "webpage_url": "https://www.youtube.com/shorts/x",
            "formats": [{"format_id": "1", "vcodec": "avc1", "acodec": "none", "width": 720, "height": 1280, "ext": "mp4", "tbr": 900},
                        {"format_id": "2", "vcodec": "none", "acodec": "opus", "abr": 128, "ext": "webm"}]}
    m = formats.build_media(info, info["webpage_url"])
    assert m["video"][0]["label"] == "720p" and m["aspect"] == "9:16" and m["has_audio"] is True


def test_silent_post_has_no_audio():
    info = {"id": "r", "title": "t", "webpage_url": "https://www.instagram.com/reel/x/",
            "formats": [{"format_id": "dash-1v", "vcodec": "avc1.64001F", "acodec": "none", "width": 720,
                         "height": 1280, "ext": "mp4", "tbr": 1000}]}
    m = formats.build_media(info, info["webpage_url"])
    assert m["has_audio"] is False and m["audio"] == []


def test_x_hls_audio_without_codec_counts_as_aac():
    info = {"id": "x", "title": "t", "duration": 10, "webpage_url": "https://x.com/a/status/1", "formats": [
        {"format_id": "hls-audio-128000-Audio", "ext": "mp4", "vcodec": "none", "acodec": None, "tbr": 128, "protocol": "m3u8_native"},
        {"format_id": "http-288", "ext": "mp4", "vcodec": None, "acodec": None, "width": 480, "height": 270, "tbr": 288},
        {"format_id": "hls-63", "ext": "mp4", "vcodec": "avc1.4D4015", "acodec": "none", "width": 480, "height": 270, "tbr": 63}]}
    m = formats.build_media(info, info["webpage_url"])
    assert m["audio"][0]["codec"] == "AAC"
    v = m["video"][0]["variants"]
    assert v[0]["codec"] == "Original" and v[0]["muxed"] and v[0]["container"] == "mp4"
    assert v[1]["codec"] == "H.264" and v[1]["audio_id"] == "hls-audio-128000-Audio" and v[1]["container"] == "mp4"


def test_no_audio_error():
    assert errors.classify("ERROR: Postprocessing: WARNING: unable to obtain file audio codec with ffprobe") == "no_audio"


def test_private_network_preflight_allowed_only_for_known_origins():
    from fastapi.testclient import TestClient
    from ytdown_engine.app import app
    c = TestClient(app, base_url="http://127.0.0.1:8787")
    hdrs = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Private-Network": "true"}
    ok = c.options("/api/info", headers={**hdrs, "Origin": "https://ytdown-beta.vercel.app"})
    assert ok.status_code == 200
    assert ok.headers.get("access-control-allow-private-network") == "true"
    bad = c.options("/api/info", headers={**hdrs, "Origin": "https://ytdown.vercel.app"})
    assert bad.status_code == 400
    assert "access-control-allow-origin" not in bad.headers


def test_server_blocked_only_in_hosted_mode():
    from ytdown_engine import errors
    yt = RuntimeError("ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies")
    tt = RuntimeError("ERROR: [TikTok] 123: Unexpected response from webpage request; please report this issue")
    assert errors.from_exception(yt)["code"] == "rate_limited"
    assert errors.from_exception(yt, hosted=True)["code"] == "server_blocked"
    assert errors.from_exception(tt, hosted=True)["code"] == "server_blocked"
    assert errors.from_exception(tt)["code"] in ("unknown", "engine_outdated")
    assert errors.from_exception(RuntimeError("HTTP Error 404: Not Found"), hosted=True)["code"] == "unavailable"


def test_proxy_and_server_cookies_apply_per_site(tmp_path, monkeypatch):
    from ytdown_engine.jobs import CookieStore, base_opts
    from ytdown_engine.settings import Settings
    ck = tmp_path / "ig.txt"
    ck.write_text("# Netscape HTTP Cookie File\n", encoding="utf-8")
    s = Settings(mode="hosted", temp_dir=str(tmp_path), proxy="http://u:p@proxy.example:8080", cookies_file=str(ck))
    yt = base_opts(s, CookieStore(), tmp_path, "https://www.youtube.com/watch?v=aqz-KE-bpKQ")
    assert yt["proxy"] == s.proxy and "cookiefile" not in yt
    ig = base_opts(s, CookieStore(), tmp_path, "https://www.instagram.com/stories/someone/123/")
    assert "proxy" not in ig and ig["cookiefile"].endswith("cookies.txt")
    x = base_opts(s, CookieStore(), tmp_path, "https://x.com/a/status/1")
    assert "proxy" not in x and "cookiefile" not in x


def test_proxy_password_hidden_in_errors():
    from ytdown_engine import errors
    p = errors.to_payload("network", "Unable to connect to proxy http://user:secret@1.2.3.4:8080")
    assert "secret" not in p["details"] and "[hidden]@" in p["details"]
