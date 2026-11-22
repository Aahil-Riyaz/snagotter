import { Fragment, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AudioFormat, Group, JobRequest, SingleMedia, Size, Variant } from "../lib/api";
import { bytes, cx, parseTime, previewName } from "../lib/util";

// ------------------------------------------------------------------ selection model

export type AudioChoice = "original" | "mp3-320" | "mp3-192" | "mp3-128" | "m4a-256" | "opus-160" | "flac" | "wav";

export interface Sel {
  mode: "av" | "video" | "audio";
  compat: boolean;
  groupKey: string | null;
  codec: string | null;
  audio: AudioChoice;
  subs: { lang: string; auto: boolean; embed: boolean } | null;
  thumb: boolean;
  trim: { start: string; end: string };
  embedMeta: boolean;
  gif: boolean;
}

export const CONVERSIONS: { id: AudioChoice; name: string; codec: "mp3" | "m4a" | "opus" | "flac" | "wav"; kbps: number | null; est: number; ext: string }[] = [
  { id: "mp3-320", name: "MP3 320", codec: "mp3", kbps: 320, est: 320, ext: "mp3" },
  { id: "mp3-192", name: "MP3 192", codec: "mp3", kbps: 192, est: 192, ext: "mp3" },
  { id: "mp3-128", name: "MP3 128", codec: "mp3", kbps: 128, est: 128, ext: "mp3" },
  { id: "m4a-256", name: "M4A (AAC) 256", codec: "m4a", kbps: 256, est: 256, ext: "m4a" },
  { id: "opus-160", name: "Opus 160", codec: "opus", kbps: 160, est: 160, ext: "opus" },
  { id: "flac", name: "FLAC", codec: "flac", kbps: null, est: 900, ext: "flac" },
  { id: "wav", name: "WAV", codec: "wav", kbps: null, est: 1536, ext: "wav" },
];

export function hasH264(m: SingleMedia) {
  return m.video.some((g) => g.variants.some((v) => v.codec === "H.264"));
}
const allowed = (m: SingleMedia, s: Sel) => (v: Variant) => !(s.compat && hasH264(m)) || v.codec === "H.264";
export const groupEnabled = (m: SingleMedia, s: Sel, g: Group) => g.variants.some(allowed(m, s));

export function pickVariant(m: SingleMedia, s: Sel, g: Group): Variant | null {
  const ok = g.variants.filter(allowed(m, s));
  return ok.find((v) => v.codec === s.codec) ?? ok[0] ?? null;
}

export function defaultSel(m: SingleMedia, compat: boolean, mode: Sel["mode"]): Sel {
  const s: Sel = {
    mode: !m.video.length ? "audio" : mode === "audio" && !m.has_audio ? "av" : mode, compat, groupKey: null, codec: null, audio: "original",
    subs: null, thumb: false, trim: { start: "", end: "" }, embedMeta: true, gif: false,
  };
  const g = m.video.find((x) => groupEnabled(m, s, x));
  s.groupKey = g?.key ?? null;
  s.codec = g ? pickVariant(m, s, g)?.codec ?? null : null;
  return s;
}

function trimRange(s: Sel, dur: number | null): { start: number; end: number } | null | "invalid" {
  const a = parseTime(s.trim.start);
  const b = parseTime(s.trim.end);
  if (a === null && b === null) return null;
  const start = a ?? 0;
  const end = b ?? dur ?? NaN;
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start || (dur && start >= dur)) return "invalid";
  return { start, end: dur ? Math.min(end, dur) : end };
}

function sizeText(sz: Size | null, scale = 1) {
  if (!sz || sz.bytes == null) return { text: "size unknown", approx: true };
  const approx = sz.approx || scale !== 1;
  return { text: `${approx ? "≈ " : ""}${bytes(Math.round(sz.bytes * scale))}`, approx };
}

export interface Resolved {
  ok: boolean;
  req: JobRequest | null;
  button: string;
  short: string;
  detail: string;
  size: string;
  rows: [string, string][];
  filename: string;
  note: string | null;
  trimError: boolean;
}

export function resolve(m: SingleMedia, s: Sel): Resolved {
  const tr = trimRange(s, m.duration);
  const scale = tr && tr !== "invalid" && m.duration ? (tr.end - tr.start) / m.duration : 1;
  const opts: JobRequest["options"] = {
    subtitles: s.mode !== "audio" ? s.subs : null,
    thumbnail: s.mode !== "audio" && s.thumb,
    trim: tr && tr !== "invalid" ? tr : null,
    embed_meta: s.embedMeta,
    gif: s.mode !== "audio" && s.gif,
  };
  const base = { url: m.url, title: m.title, options: opts } as const;
  const bad: Resolved = { ok: false, req: null, button: "Pick a format", short: "", detail: "", size: "", rows: [], filename: "", note: null, trimError: tr === "invalid" };

  if (s.mode === "audio") {
    const src: AudioFormat | undefined = m.audio[0];
    if (s.audio === "original") {
      const ext = src?.codec === "AAC" ? "m4a" : src?.codec === "Opus" ? "opus" : src?.ext ?? "m4a";
      const sz = sizeText(src?.size ?? null, scale);
      return {
        ok: !!src && tr !== "invalid", trimError: tr === "invalid",
        req: { ...base, mode: "audio", audio_id: src?.format_id ?? null },
        button: `Download ${src?.codec ?? "audio"} · ${sz.text}`,
        short: `${src?.codec ?? "Audio"} original`, detail: src ? `${src.codec}${src.abr ? ` · ${src.abr} kbps` : ""}` : "",
        size: sz.text,
        rows: [["Audio", src ? `${src.codec}${src.abr ? ` · ${src.abr} kbps` : ""}` : "Best available"], ["Size", sz.text], ["Re-encoding", "None"]],
        filename: previewName(m.title, m.uploader, null, ext), note: null,
      };
    }
    const c = CONVERSIONS.find((x) => x.id === s.audio)!;
    const est: Size = { bytes: m.duration ? Math.round(c.est * 125 * m.duration) : null, approx: true };
    const sz = sizeText(est, scale);
    const srcKbps = src?.abr ?? null;
    let note: string | null = null;
    if (c.kbps && srcKbps && c.kbps > srcKbps) note = `The source is ${src!.codec} at ${srcKbps} kbps. Converting to ${c.kbps} kbps adds size, not quality.`;
    if (!c.kbps && src) note = `${c.name} is lossless, but the source is ${src.codec}${srcKbps ? ` at ${srcKbps} kbps` : ""}, so the sound stays the same and the file gets bigger.`;
    return {
      ok: tr !== "invalid", trimError: tr === "invalid",
      req: { ...base, mode: "audio", audio_id: src?.format_id ?? null, convert: { codec: c.codec, bitrate: c.kbps } },
      button: `Download ${c.name} · ${sz.text}`, short: c.name, detail: `from ${src?.codec ?? "best audio"}`, size: sz.text,
      rows: [["Audio", `${c.name}${c.kbps ? " kbps" : ""}`], ["From", src ? `${src.codec}${srcKbps ? ` · ${srcKbps} kbps` : ""}` : "best audio"], ["Size", sz.text], ["Re-encoding", "Yes, to " + c.codec.toUpperCase()]],
      filename: previewName(m.title, m.uploader, null, c.ext), note,
    };
  }

  const g = m.video.find((x) => x.key === s.groupKey);
  const v = g ? pickVariant(m, s, g) : null;
  if (!g || !v) return bad;
  const videoOnly = s.mode === "video";
  const gif = !!opts.gif;
  const container = gif ? "gif" : videoOnly ? (v.muxed ? v.container : v.source_ext ?? v.container) : s.compat && hasH264(m) ? "mp4" : v.container;
  const sz = sizeText(gif ? null : videoOnly ? v.size_v : v.size_av, scale);
  const label = gif ? "GIF" : videoOnly ? `${g.label}, no audio` : g.label;
  const fps = g.fps ? `${g.fps}` : "";
  const res = g.label === g.res || !g.res ? g.label : `${g.label} ${g.res}`;
  const req: JobRequest = {
    ...base,
    mode: videoOnly ? "video" : "av",
    format_id: v.format_id,
    audio_id: videoOnly ? null : v.audio_id,
    muxed: v.muxed,
    container: videoOnly || gif ? null : container,
    compat: s.compat && hasH264(m),
  };
  const what = gif ? "GIF" : videoOnly ? `${g.label} video only` : `${g.label} ${container.toUpperCase()}`;
  return {
    ok: tr !== "invalid", trimError: tr === "invalid", req,
    button: `Download ${what}${gif ? "" : ` · ${sz.text}`}`,
    short: `${g.res ?? g.label}${fps} ${gif ? "GIF" : container.toUpperCase()}`,
    detail: videoOnly ? `${v.codec}, no audio` : `${v.codec === "Original" ? "Site's own file" : v.codec}${v.audio_codec ? ` + ${v.audio_codec === "Unknown" ? "audio" : v.audio_codec}` : ", no sound"}`,
    size: sz.text,
    rows: [
      ["Video", `${v.codec} · ${res}${fps}`],
      ["Audio", videoOnly || gif ? "None" : audioLabel(m, v)],
      ["Size", gif ? "depends on length" : sz.text],
      ["Re-encoding", gif ? "Yes, to GIF" : "None"],
    ],
    filename: previewName(m.title, m.uploader, label, container),
    note: v.watermarked ? "This version has the site's watermark. It's the only one offered at this quality." : null,
  };
}

function audioLabel(m: SingleMedia, v: Variant): string {
  if (v.muxed) return v.audio_codec === "Unknown" ? "Included" : v.audio_codec ?? "None (silent)";
  const a = m.audio.find((x) => x.format_id === v.audio_id);
  return a ? `${a.codec}${a.abr ? ` · ${a.abr} kbps` : ""}` : v.audio_codec ?? "Best available";
}

// ------------------------------------------------------------------ mode + compat

export function Controls({ m, s, set }: { m: SingleMedia; s: Sel; set: (p: Partial<Sel>) => void }) {
  const modes: [Sel["mode"], string][] = [["av", "Video + audio"], ["video", "Video only"], ["audio", "Audio only"]];
  const noVideo = !m.video.length;
  const canCompat = hasH264(m);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="controls">
      <div className="seg" role="radiogroup" aria-label="What to download">
        {modes.map(([k, label], i) => (
          <button
            key={k}
            ref={(el) => { refs.current[i] = el; }}
            role="radio"
            aria-checked={s.mode === k}
            tabIndex={s.mode === k ? 0 : -1}
            disabled={(noVideo && k !== "audio") || (k === "audio" && !m.has_audio)}
            onClick={() => set({ mode: k })}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const order = noVideo ? [2] : m.has_audio ? [0, 1, 2] : [0, 1];
              const at = order.indexOf(i);
              const next = order[(at + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
              set({ mode: modes[next][0] });
              refs.current[next]?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {s.mode !== "audio" && (
        <>
          <button className="toggle" role="switch" aria-checked={s.compat && canCompat} disabled={!canCompat}
            aria-describedby="compat-help" onClick={() => set({ compat: !s.compat })}>
            <span className="track" aria-hidden="true" />Plays everywhere
          </button>
          <p className="explain" id="compat-help">
            {!canCompat
              ? "This site doesn't offer H.264, so files keep their original codec."
              : s.compat
                ? `H.264 video${s.mode === "av" ? " with AAC audio in an MP4" : " in an MP4"} plays on any phone, TV or editor.${m.platform === "youtube" ? " YouTube only offers H.264 up to 1080p, so 4K and 2K need this off." : ""}`
                : "Off: you get the true best quality (AV1 or VP9 with Opus). Some phones and editors can't play these."}
          </p>
        </>
      )}
      {noVideo && <p className="explain">There's no video here, only audio.</p>}
      {!m.has_audio && !noVideo && <p className="explain">This post has no sound, so there's nothing to save as audio.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ video spec sheet

export function SpecSheet({ m, s, set, onCommit }: { m: SingleMedia; s: Sel; set: (p: Partial<Sel>) => void; onCommit: () => void }) {
  const videoOnly = s.mode === "video";
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = m.video.filter((g) => groupEnabled(m, s, g));
  const anyApprox = m.video.some((g) => g.variants.some((v) => (videoOnly ? v.size_v : v.size_av).approx));
  const hiddenByCompat = m.video.length - enabled.length;

  const move = (from: Group, dir: 1 | -1) => {
    const i = enabled.findIndex((g) => g.key === from.key);
    const n = enabled[Math.max(0, Math.min(enabled.length - 1, i + dir))];
    if (n) {
      set({ groupKey: n.key, codec: pickVariant(m, s, n)?.codec ?? null });
      rowRefs.current[n.key]?.focus();
    }
  };

  return (
    <div className="sheet" role="radiogroup" aria-label="Video quality">
      <div className="row head" aria-hidden="true">
        <span>Quality</span><span>fps</span><span>Codec</span><span>Container</span><span className="sz">Size</span>
      </div>
      {m.video.map((g) => {
        const on = groupEnabled(m, s, g);
        const sel = s.groupKey === g.key;
        const v = pickVariant(m, s, g) ?? g.variants[0];
        const sz = sizeText(videoOnly ? v.size_v : v.size_av);
        const container = videoOnly ? (v.source_ext ?? v.container) : s.compat && hasH264(m) && on ? "mp4" : v.container;
        const name = `${g.label}${g.res && g.res !== g.label ? ` ${g.res}` : ""}${g.fps ? `, ${g.fps} fps` : ""}${g.hdr ? ", HDR" : ""}`;
        return (
          <div key={g.key} className={cx("row", sel && "sel", !on && "off")}>
            <button
              ref={(el) => { rowRefs.current[g.key] = el; }}
              className="row-hit"
              role="radio"
              aria-checked={sel}
              aria-disabled={!on || undefined}
              aria-label={`${name}, ${v.codec}, ${container.toUpperCase()}, ${sz.text}${!on ? ", needs Plays everywhere off" : ""}`}
              tabIndex={sel ? 0 : -1}
              onClick={() => on && set({ groupKey: g.key, codec: v.codec })}
              onDoubleClick={() => on && onCommit()}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); move(g, 1); }
                else if (e.key === "ArrowUp") { e.preventDefault(); move(g, -1); }
                else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const ok = g.variants.filter((x) => groupEnabled(m, s, { ...g, variants: [x] }));
                  const i = ok.findIndex((x) => x.codec === v.codec);
                  const n = ok[(i + (e.key === "ArrowRight" ? 1 : ok.length - 1)) % ok.length];
                  if (n) set({ codec: n.codec });
                }
              }}
            />
            <span className="q">
              {g.label !== g.res && g.res ? <>{g.label} <span className="mono">{g.res}</span></> : <span className="mono">{g.label}</span>}
              {g.fps ? <span className="fpsm mono">{g.fps}</span> : null}
              {g.best && <span className="badge">Best</span>}
              {g.hdr && <span className="badge hdr">HDR</span>}
            </span>
            <span className="mono fps">{g.fps ?? "–"}</span>
            <span className="chips" role="radiogroup" aria-label={`Codec for ${g.label}`}>
              {g.variants.map((x) => {
                const xOk = groupEnabled(m, s, { ...g, variants: [x] });
                return (
                  <button key={x.format_id} className="chip" role="radio" tabIndex={-1}
                    aria-checked={sel && x.codec === v.codec} disabled={!xOk}
                    title={x.watermarked ? "Has the site's watermark" : undefined}
                    onClick={() => set({ groupKey: g.key, codec: x.codec })}>
                    {x.codec}{x.watermarked ? "·wm" : ""}
                  </button>
                );
              })}
            </span>
            <span className="mono ct">{container.toUpperCase()}</span>
            <span className="mono sz">{sz.approx && sz.text !== "size unknown" ? <span className="approx" title="Estimated from bitrate">≈</span> : null}{sz.text.replace("≈ ", "")}</span>
          </div>
        );
      })}
      <div className="note">
        {videoOnly ? "Sizes are for the video track alone." : "Sizes include the audio track."}
        {anyApprox ? <> <span className="approx">≈</span> means estimated from bitrate.</> : null}
        {hiddenByCompat > 0 && s.compat ? ` ${hiddenByCompat} ${hiddenByCompat === 1 ? "quality isn't" : "qualities aren't"} offered in H.264; turn off Plays everywhere to use ${hiddenByCompat === 1 ? "it" : "them"}.` : ""}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ audio sheet

export function AudioSheet({ m, s, set }: { m: SingleMedia; s: Sel; set: (p: Partial<Sel>) => void }) {
  const src = m.audio[0];
  const opts: { id: AudioChoice; name: string; detail: string; size: string }[] = [
    { id: "original", name: "Original", detail: src ? `${src.codec}${src.abr ? ` · ${src.abr} kbps` : ""}, no re-encoding` : "best available", size: sizeText(src?.size ?? null).text },
    ...CONVERSIONS.map((c) => ({
      id: c.id, name: c.name, detail: c.kbps ? `${c.codec.toUpperCase()} · ${c.kbps} kbps` : c.codec === "flac" ? "lossless, compressed" : "lossless, uncompressed",
      size: sizeText({ bytes: m.duration ? Math.round(c.est * 125 * m.duration) : null, approx: true }).text,
    })),
  ];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="sheet" role="radiogroup" aria-label="Audio format">
      <div className="row head row-audio" aria-hidden="true"><span>Format</span><span>Details</span><span className="sz">Size</span></div>
      {opts.map((o, i) => {
        const sel = s.audio === o.id;
        return (
          <div key={o.id} className={cx("row row-audio", sel && "sel")}>
            <button ref={(el) => { refs.current[i] = el; }} className="row-hit" role="radio" aria-checked={sel} tabIndex={sel ? 0 : -1}
              aria-label={`${o.name}, ${o.detail}, ${o.size}`}
              onClick={() => set({ audio: o.id })}
              onKeyDown={(e) => {
                if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                e.preventDefault();
                const n = Math.max(0, Math.min(opts.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
                set({ audio: opts[n].id });
                refs.current[n]?.focus();
              }} />
            <span className="q">{o.name}{o.id === "original" && <span className="badge">Best</span>}</span>
            <span className="mono dt">{o.detail}</span>
            <span className="mono sz">{o.size}</span>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ more options

const langName = (code: string) => {
  try {
    return new Intl.DisplayNames([navigator.language || "en"], { type: "language" }).of(code.replace(/-orig$/, "")) ?? code;
  } catch {
    return code;
  }
};

export function MoreOptions({ m, s, set, r }: { m: SingleMedia; s: Sel; set: (p: Partial<Sel>) => void; r: Resolved }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const subsList = [...m.subtitles.manual.map((l) => ({ v: `m:${l}`, t: langName(l) })), ...m.subtitles.auto.map((l) => ({ v: `a:${l}`, t: `${langName(l)} (auto-generated)` }))];
  const shortClip = (m.duration ?? 999) <= 90;
  const summary = s.mode === "audio" ? "Trim, tags and cover art" : `${subsList.length ? "Subtitles, " : ""}thumbnail, trim${shortClip ? ", GIF" : ""}`;
  return (
    <div className="more-wrap">
      <button className="more" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <ChevronDown size={18} strokeWidth={1.5} aria-hidden="true" className={cx("chev", open && "chev-open")} />
        More options: {summary.toLowerCase()}
      </button>
      <div id={id} className="more-panel" hidden={!open}>
        {s.mode !== "audio" && subsList.length > 0 && (
          <div className="opt">
            <label className="field-inline">
              <span>Subtitles</span>
              <select className="select" value={s.subs ? `${s.subs.auto ? "a" : "m"}:${s.subs.lang}` : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  set({ subs: v ? { lang: v.slice(2), auto: v.startsWith("a:"), embed: s.subs?.embed ?? true } : null });
                }}>
                <option value="">None</option>
                {subsList.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
              </select>
            </label>
            {s.subs && (
              <label className="check">
                <input type="checkbox" checked={s.subs.embed} onChange={(e) => set({ subs: { ...s.subs!, embed: e.target.checked } })} />
                Put them inside the video (otherwise you get a separate .srt file)
              </label>
            )}
          </div>
        )}
        {s.mode !== "audio" && (
          <label className="check opt">
            <input type="checkbox" checked={s.thumb} onChange={(e) => set({ thumb: e.target.checked })} />
            Also save the thumbnail as a JPG
          </label>
        )}
        {s.mode === "audio" && s.audio !== "wav" && (
          <label className="check opt">
            <input type="checkbox" checked={s.embedMeta} onChange={(e) => set({ embedMeta: e.target.checked })} />
            Add title, artist and cover art to the file
          </label>
        )}
        {s.mode !== "audio" && shortClip && (
          <label className="check opt">
            <input type="checkbox" checked={s.gif} onChange={(e) => set({ gif: e.target.checked })} />
            Convert to GIF (no sound, up to 480 px wide)
          </label>
        )}
        <fieldset className="opt trim">
          <legend>Trim <span className="help-inline">optional, as m:ss</span></legend>
          <label><span className="sr">Start</span><input className="input mono" inputMode="numeric" placeholder="0:00" value={s.trim.start}
            aria-invalid={r.trimError || undefined} onChange={(e) => set({ trim: { ...s.trim, start: e.target.value } })} /></label>
          <span aria-hidden="true">to</span>
          <label><span className="sr">End</span><input className="input mono" inputMode="numeric" placeholder={m.duration ? fmtDur(m.duration) : "end"} value={s.trim.end}
            aria-invalid={r.trimError || undefined} onChange={(e) => set({ trim: { ...s.trim, end: e.target.value } })} /></label>
          {r.trimError && <p className="help help-err" role="alert">The end has to come after the start, inside the video's length.</p>}
        </fieldset>
        <div className="opt">
          <span className="label">File name</span>
          <p className="fname" dir="auto">{r.filename}</p>
        </div>
      </div>
    </div>
  );
}

function fmtDur(s: number) {
  const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = Math.round(s % 60);
  return h ? `${h}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${mm}:${String(ss).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ summary + sticky bar

export function Summary({ r, onDownload, busy, local }: { r: Resolved; onDownload: () => void; busy: boolean; local: boolean }) {
  return (
    <div className="summary">
      <h2>Your file</h2>
      <p className="fname" dir="auto">{r.filename || "–"}</p>
      <dl>
        {r.rows.map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd className="mono">{v}</dd></Fragment>))}
      </dl>
      {r.note && <p className="small note-warn">{r.note}</p>}
      <button className="btn btn-1 big" onClick={onDownload} disabled={!r.ok || busy} aria-keyshortcuts="D">
        {busy ? "Starting…" : r.button}
      </button>
      <p className="small">{local ? "Saves to your browser's downloads. Press D to start." : "Saves to your browser's downloads."}</p>
    </div>
  );
}

export function StickyBar({ r, onDownload, busy }: { r: Resolved; onDownload: () => void; busy: boolean }) {
  return (
    <div className="sticky">
      <div className="what"><b>{r.short}</b><span className="mono">{r.detail}</span></div>
      <button className="btn btn-1" onClick={onDownload} disabled={!r.ok || busy}>
        {busy ? "Starting…" : `Download${r.size && r.size !== "size unknown" ? ` · ${r.size}` : ""}`}
      </button>
    </div>
  );
}
