"""Engine settings: environment variables override a small local settings.json."""
from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path

DEFAULT_ORIGINS = [
    "http://127.0.0.1:8787", "http://localhost:8787",
    "http://127.0.0.1:5173", "http://localhost:5173",
    "https://ytdown.vercel.app",
]


def config_dir() -> Path:
    base = os.environ.get("APPDATA") or os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    p = Path(base) / "ytdown"
    p.mkdir(parents=True, exist_ok=True)
    return p


@dataclass
class Settings:
    mode: str = "local"                     # "local" or "hosted"
    host: str = "127.0.0.1"
    port: int = 8787
    max_concurrent: int = 3
    ttl_seconds: int = 3600
    temp_dir: str = field(default_factory=lambda: str(Path(tempfile.gettempdir()) / "ytdown"))
    max_temp_bytes: int = 20 * 1024**3
    save_dir: str = field(default_factory=lambda: str(Path.home() / "Downloads" / "ytdown"))
    channel: str = "stable"                 # "stable" or "nightly"
    origins: list[str] = field(default_factory=lambda: list(DEFAULT_ORIGINS))
    # hosted-mode guards
    max_filesize_mb: int = 1024
    max_duration_s: int = 3 * 3600
    rate_per_minute: int = 20

    @property
    def local(self) -> bool:
        return self.mode == "local"

    @classmethod
    def load(cls) -> "Settings":
        s = cls()
        f = config_dir() / "settings.json"
        if f.exists():
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                for k in ("save_dir", "max_concurrent", "ttl_seconds", "channel"):
                    if k in data:
                        setattr(s, k, data[k])
            except (OSError, ValueError):
                pass
        env = os.environ
        s.mode = env.get("YTDOWN_MODE", s.mode)
        s.host = env.get("YTDOWN_HOST", s.host)
        s.port = int(env.get("YTDOWN_PORT", s.port))
        s.max_concurrent = max(1, min(6, int(env.get("YTDOWN_CONCURRENCY", s.max_concurrent))))
        s.ttl_seconds = int(env.get("YTDOWN_TTL", s.ttl_seconds))
        s.temp_dir = env.get("YTDOWN_TEMP", s.temp_dir)
        s.max_temp_bytes = int(float(env.get("YTDOWN_MAX_TEMP_GB", s.max_temp_bytes / 1024**3)) * 1024**3)
        if env.get("YTDOWN_ORIGINS"):
            s.origins = [o.strip().rstrip("/") for o in env["YTDOWN_ORIGINS"].split(",") if o.strip()]
        else:
            s.origins = list(dict.fromkeys(s.origins + [f"http://127.0.0.1:{s.port}", f"http://localhost:{s.port}"]))
        s.max_filesize_mb = int(env.get("YTDOWN_MAX_FILESIZE_MB", s.max_filesize_mb))
        s.max_duration_s = int(env.get("YTDOWN_MAX_DURATION_S", s.max_duration_s))
        s.rate_per_minute = int(env.get("YTDOWN_RATE_PER_MINUTE", s.rate_per_minute))
        Path(s.temp_dir).mkdir(parents=True, exist_ok=True)
        return s

    def save(self) -> None:
        data = {k: v for k, v in asdict(self).items() if k in ("save_dir", "max_concurrent", "ttl_seconds", "channel")}
        (config_dir() / "settings.json").write_text(json.dumps(data, indent=2), encoding="utf-8")

    def public(self) -> dict:
        return {"mode": self.mode, "max_concurrent": self.max_concurrent, "ttl_seconds": self.ttl_seconds,
                "save_dir": self.save_dir if self.local else None, "channel": self.channel}
