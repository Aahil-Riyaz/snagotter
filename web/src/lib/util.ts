import type { Platform } from "./api";

// --- link detection (instant, client-side; the engine validates again) -------------

const HOSTS: [Platform, RegExp][] = [
  ["youtube", /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i],
  ["instagram", /(^|\.)instagram\.com$/i],
  ["tiktok", /(^|\.)tiktok\.com$/i],
  ["x", /(^|\.)(x\.com|twitter\.com|fxtwitter\.com|vxtwitter\.com|fixupx\.com|fixvx\.com)$/i],
  ["facebook", /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/i],
];

export const PLATFORM_NAME: Record<Platform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  facebook: "Facebook",
  other: "Other site",
};

export function toUrl(raw: string): URL | null {
  const s = raw.trim().replace(/^<|>$/g, "");
  if (!s || /\s/.test(s)) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u;
  } catch {
    return null;
  }
}

export function detect(raw: string): Platform | null {
  const u = toUrl(raw);
  if (!u) return null;
  for (const [p, rx] of HOSTS) if (rx.test(u.hostname)) return p;
  return "other";
}

export function splitLinks(text: string): string[] {
  const out: string[] = [];
  for (const t of text.split(/[\s,]+/)) {
    const u = toUrl(t);
    if (u && !out.includes(u.href)) out.push(u.href);
  }
  return out;
}

// --- formatting ----------------------------------------------------------------------

export function bytes(n: number | null | undefined): string {
  if (n == null) return "size unknown";
  if (n < 1000) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
}

export function duration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

export function speed(bps: number | null): string {
  return bps ? `${bytes(bps)}/s` : "–";
}

export function date(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "1:23" / "83" / "1:02:03" → seconds */
export function parseTime(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return NaN;
  return t.split(":").reduce((acc, p) => acc * 60 + parseFloat(p), 0);
}

/** Mirrors the engine's filename rule closely enough for a preview. */
export function previewName(title: string, uploader: string | null, label: string | null, ext: string): string {
  const clean = (s: string) => s.replace(/[/\\:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  const t = clean(title) || "download";
  const u = uploader ? clean(uploader) : "";
  const head = !u || t.toLowerCase().includes(u.toLowerCase()) ? t : `${t} — ${u}`;
  return `${head}${label ? ` (${label})` : ""}.${ext}`;
}

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}
