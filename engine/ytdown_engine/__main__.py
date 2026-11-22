"""`python -m ytdown_engine` - run the engine under a tiny supervisor.

The supervisor restarts the server when it exits with code 3 (after "Update engine"),
so a fresh yt-dlp is imported without the user doing anything.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import webbrowser


def main() -> int:
    ap = argparse.ArgumentParser(prog="ytdown", description="Run the ytdown engine.")
    ap.add_argument("--host", default=os.environ.get("YTDOWN_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("YTDOWN_PORT", "8787")))
    ap.add_argument("--mode", choices=["local", "hosted"], default=os.environ.get("YTDOWN_MODE", "local"))
    ap.add_argument("--open", action="store_true", help="open the app in your browser")
    ap.add_argument("--reload", action="store_true", help="dev: reload on code changes")
    a = ap.parse_args()

    # Inside Docker the engine must listen on 0.0.0.0; compose publishes it on 127.0.0.1 only.
    in_docker = os.environ.get("YTDOWN_IN_DOCKER") == "1"
    if a.mode == "local" and a.host not in ("127.0.0.1", "localhost", "::1") and not in_docker:
        print("Local mode only listens on 127.0.0.1. Use --mode hosted to expose it.", file=sys.stderr)
        return 2

    env = {**os.environ, "YTDOWN_SUPERVISED": "1", "YTDOWN_MODE": a.mode,
           "YTDOWN_HOST": a.host, "YTDOWN_PORT": str(a.port)}
    cmd = [sys.executable, "-m", "uvicorn", "ytdown_engine.app:app", "--host", a.host, "--port", str(a.port),
           "--log-level", "warning", "--no-access-log"]
    if a.reload:
        cmd.append("--reload")
    print(f"ytdown engine on http://{'127.0.0.1' if a.host in ('0.0.0.0', '::') else a.host}:{a.port}  (Ctrl+C to stop)")
    opened = False
    while True:
        proc = subprocess.Popen(cmd, env=env)
        if a.open and not opened:
            opened = True
            webbrowser.open(f"http://127.0.0.1:{a.port}")
        try:
            code = proc.wait()
        except KeyboardInterrupt:
            proc.terminate()
            return 0
        if code != 3:
            return code
        print("Engine updated, restarting…")


if __name__ == "__main__":
    raise SystemExit(main())
