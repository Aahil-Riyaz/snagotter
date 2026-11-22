// Typed client for the ytdown engine. The engine is found in this order:
// 1. same origin (served by the engine, or the Vite dev proxy)
// 2. a URL the user saved in settings
// 3. VITE_ENGINE_URL (Vercel build) or http://127.0.0.1:8787

export type Platform = "youtube" | "instagram" | "tiktok" | "x" | "facebook" | "other";
export type Size = { bytes: number | null; approx: boolean };

export interface Variant {
  format_id: string;
  codec: string;
  muxed: boolean;
  audio_id: string | null;
  audio_codec: string | null;
  container: string;
  source_ext: string | null;
  tbr: number | null;
  size_av: Size;
  size_v: Size;
  watermarked: boolean;
  width: number | null;
  height: number | null;
}
export interface Group {
  key: string;
  height: number | null;
  fps: number | null;
  hdr: boolean;
  label: string;
  res: string | null;
  variants: Variant[];
  best: boolean;
}
export interface AudioFormat {
  format_id: string;
  codec: string;
  abr: number | null;
  channels: number | null;
  surround: boolean;
  ext: string | null;
  size: Size;
  language: string | null;
}
export interface Entry {
  index: number;
  id: string;
  title: string;
  url: string;
  duration: number | null;
  thumbnail: string | null;
  has_video: boolean;
}
interface MediaBase {
  id: string;
  title: string;
  uploader: string | null;
  platform: Platform;
  extractor: string;
  webpage_url: string;
  thumbnail: string | null;
  url: string;
  playlist_choice: { video_url: string; playlist_url: string } | null;
}
export interface SingleMedia extends MediaBase {
  kind: "single";
  has_audio: boolean;
  duration: number | null;
  upload_date: string | null;
  live_status: string | null;
  aspect: "16:9" | "9:16" | "1:1";
  video: Group[];
  audio: AudioFormat[];
  subtitles: { manual: string[]; auto: string[] };
}
export interface ListMedia extends MediaBase {
  kind: "playlist" | "carousel";
  count: number;
  entries: Entry[];
}
export type Media = SingleMedia | ListMedia;

export interface ApiError {
  code: string;
  title: string;
  hint: string | null;
  action: "open_link" | "cookies" | "retry" | "clear" | "update" | "doctor" | null;
  action_label: string | null;
  details: string | null;
}

export type JobStatus =
  | "queued" | "fetching" | "downloading_video" | "downloading_audio"
  | "merging" | "converting" | "ready" | "failed" | "cancelled";

export interface JobSnap {
  id: string;
  url: string;
  status: JobStatus;
  mode: "av" | "video" | "audio";
  percent: number | null;
  speed: number | null;
  eta: number | null;
  downloaded: number | null;
  total: number | null;
  title: string | null;
  uploader: string | null;
  filename: string | null;
  size: number | null;
  extras: string[];
  error: ApiError | null;
  saved_to: string | null;
  created: number;
}

export interface JobRequest {
  url: string;
  mode: "av" | "video" | "audio";
  format_id?: string | null;
  audio_id?: string | null;
  muxed?: boolean;
  container?: string | null;
  max_height?: number | null;
  compat?: boolean;
  convert?: { codec: "mp3" | "m4a" | "flac" | "wav" | "opus"; bitrate?: number | null } | null;
  options?: {
    subtitles?: { lang: string; auto: boolean; embed: boolean } | null;
    thumbnail?: boolean;
    trim?: { start: number; end: number } | null;
    embed_meta?: boolean;
    gif?: boolean;
  };
  items?: number | null;
  title?: string | null;
}

export interface Doctor {
  ok: boolean;
  engine: { version: string; age_days: number | null; stale: boolean; channel: "stable" | "nightly"; ejs: string | null };
  tools: Record<string, { found: boolean; version?: string | null; ok?: boolean }>;
  problems: { code: string; text: string }[];
  app_version: string;
  mode: "local" | "hosted";
  cookies: "file" | "browser" | null;
  can_update: boolean;
  supervised: boolean;
}

export class EngineError extends Error {
  constructor(public status: number, public error: ApiError) {
    super(error.title);
  }
}

const SAVED_KEY = "ytdown.engine";
const FALLBACK = (import.meta.env.VITE_ENGINE_URL as string | undefined) ?? "http://127.0.0.1:8787";
let base: string | null = null;

export function savedEngineUrl(): string | null {
  try {
    return localStorage.getItem(SAVED_KEY);
  } catch {
    return null;
  }
}
export function setSavedEngineUrl(url: string | null) {
  try {
    if (url) localStorage.setItem(SAVED_KEY, url.replace(/\/+$/, ""));
    else localStorage.removeItem(SAVED_KEY);
  } catch {
    /* private mode */
  }
  base = null;
}
export function engineBase(): string {
  return base ?? "";
}
export function fallbackEngine(): string {
  return savedEngineUrl() ?? FALLBACK;
}
/** True when the app is set to use an engine on a server rather than on this computer. */
export function remoteEngine(): boolean {
  try {
    const h = new URL(fallbackEngine()).hostname;
    return !["127.0.0.1", "localhost", "[::1]", "::1"].includes(h);
  } catch {
    return false;
  }
}

async function probe(origin: string): Promise<Doctor | null> {
  try {
    const r = await fetch(`${origin}/api/doctor`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return null;
    return (await r.json()) as Doctor;
  } catch {
    return null;
  }
}

/** Find a reachable engine. Returns its doctor report, or null when none answers. */
export async function connect(): Promise<Doctor | null> {
  const candidates = [""];
  const saved = savedEngineUrl();
  if (saved) candidates.push(saved);
  if (!candidates.includes(FALLBACK)) candidates.push(FALLBACK);
  for (const c of candidates) {
    if (c && c === location.origin) continue;
    const d = await probe(c);
    if (d) {
      base = c;
      return d;
    }
  }
  base = null;
  return null;
}

const offlineError: ApiError = {
  code: "engine_offline",
  title: "Can't reach the engine.",
  hint: "Start ytdown on your computer, then try again.",
  action: "retry",
  action_label: "Try again",
  details: null,
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${engineBase()}${path}`, {
      ...init,
      headers: init?.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : undefined,
    });
  } catch {
    throw new EngineError(0, navigator.onLine ? offlineError : {
      ...offlineError, code: "network", title: "You're offline.", hint: "Reconnect to the internet, then try again.",
    });
  }
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const e = body?.error as ApiError | undefined;
    throw new EngineError(r.status, e ?? { ...offlineError, code: "unknown", title: "Something went wrong.", details: `HTTP ${r.status}` });
  }
  return body as T;
}

export const api = {
  doctor: () => call<Doctor>("/api/doctor"),
  info: (url: string) => call<Media>("/api/info", { method: "POST", body: JSON.stringify({ url }) }),
  createJob: (req: JobRequest) => call<{ job_id: string; job: JobSnap }>("/api/jobs", { method: "POST", body: JSON.stringify(req) }),
  cancel: (id: string) => call<{ ok: boolean }>(`/api/jobs/${id}`, { method: "DELETE" }),
  save: (id: string) => call<JobSnap>(`/api/jobs/${id}/save`, { method: "POST" }),
  update: (channel?: "stable" | "nightly") =>
    call<{ ok: boolean; log: string; restarting: boolean; restart_required: boolean }>("/api/engine/update", {
      method: "POST", body: JSON.stringify(channel ? { channel } : {}),
    }),
  cookiesBrowser: (browser: string) => call<{ cookies: string }>("/api/cookies/browser", { method: "POST", body: JSON.stringify({ browser }) }),
  cookiesFile: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return call<{ cookies: string }>("/api/cookies/file", { method: "POST", body: fd });
  },
  clearCookies: () => call<{ cookies: null }>("/api/cookies", { method: "DELETE" }),
  fileUrl: (id: string, artifact: "main" | "subtitles" | "thumbnail" = "main") =>
    `${engineBase()}/api/jobs/${id}/file${artifact === "main" ? "" : `?artifact=${artifact}`}`,
};

/** Subscribe to a job's SSE stream. Reconnects quietly; returns an unsubscribe function. */
export function watchJob(id: string, onSnap: (s: JobSnap) => void): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retry = 0;
  const open = () => {
    es = new EventSource(`${engineBase()}/api/jobs/${id}/events`);
    es.addEventListener("job", (e) => {
      retry = 0;
      const snap = JSON.parse((e as MessageEvent).data) as JobSnap;
      onSnap(snap);
      if (snap.status === "ready" || snap.status === "failed" || snap.status === "cancelled") {
        closed = true;
        es?.close();
      }
    });
    es.onerror = () => {
      es?.close();
      if (closed) return;
      retry = Math.min(retry + 1, 6);
      window.setTimeout(open, 500 * 2 ** retry);
    };
  };
  open();
  return () => {
    closed = true;
    es?.close();
  };
}
