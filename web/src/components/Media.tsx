import { useMemo, useState } from "react";
import type { ListMedia, SingleMedia } from "../lib/api";
import { PLATFORM_NAME, cx, date, duration } from "../lib/util";

export function Thumb({ src, aspect, dur, platform, small }: {
  src: string | null; aspect: string; dur?: number | null; platform: string; small?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const ratio = aspect === "9:16" ? "9 / 16" : aspect === "1:1" ? "1 / 1" : "16 / 9";
  return (
    <div className={cx("thumb", small && "thumb-sm", aspect === "9:16" && "thumb-tall")} style={{ aspectRatio: ratio }}>
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <span className="thumb-none">{platform}</span>
      )}
      {dur ? <span className="dur mono">{duration(dur)}</span> : null}
    </div>
  );
}

export function MediaHeader({ media }: { media: SingleMedia }) {
  const best = media.video[0];
  return (
    <div className={cx("media", media.aspect === "9:16" && "media-tall")}>
      <Thumb src={media.thumbnail} aspect={media.aspect} dur={media.duration} platform={PLATFORM_NAME[media.platform]} />
      <div className="media-text">
        <h2 className="title" dir="auto">{media.title}</h2>
        <dl className="facts">
          {media.uploader && (<><dt>{media.platform === "youtube" ? "Channel" : "By"}</dt><dd dir="auto">{media.uploader}</dd></>)}
          <dt>Site</dt><dd>{media.platform === "other" ? media.extractor : PLATFORM_NAME[media.platform]}</dd>
          {media.duration ? (<><dt>Length</dt><dd className="mono">{duration(media.duration)}</dd></>) : null}
          {media.upload_date && (<><dt>Posted</dt><dd>{date(media.upload_date)}</dd></>)}
          {best && (<><dt>Best</dt><dd>{best.label}{best.fps ? ` at ${best.fps} fps` : ""}{best.hdr ? ", HDR" : ""}</dd></>)}
          {!best && media.audio.length > 0 && (<><dt>Best</dt><dd>Audio only</dd></>)}
        </dl>
      </div>
    </div>
  );
}

export function MiniHeader({ title, sub, thumb, aspect, platform }: {
  title: string; sub: string; thumb: string | null; aspect: string; platform: string;
}) {
  return (
    <div className="mini">
      <Thumb src={thumb} aspect={aspect} platform={platform} small />
      <div>
        <p className="title" dir="auto">{title}</p>
        <div className="sub" dir="auto">{sub}</div>
      </div>
    </div>
  );
}

/** Skeleton that has the same boxes as MediaHeader + the controls + the sheet, so nothing shifts. */
export function Skeleton({ platform }: { platform: string }) {
  return (
    <div className="skel" aria-busy="true" aria-live="polite">
      <span className="sr">Fetching formats from {platform}…</span>
      <div className="media">
        <div className="thumb sk" style={{ aspectRatio: platform === "TikTok" ? "9 / 16" : "16 / 9" }} />
        <div className="media-text">
          <div className="sk sk-line" style={{ width: "86%", height: 22 }} />
          <div className="sk sk-line" style={{ width: "60%", height: 22, marginTop: 6 }} />
          <div className="sk sk-line" style={{ width: "40%", marginTop: 16 }} />
          <div className="sk sk-line" style={{ width: "30%" }} />
          <div className="sk sk-line" style={{ width: "36%" }} />
        </div>
      </div>
      <div className="controls"><div className="sk" style={{ width: 360, maxWidth: "100%", height: 44 }} /></div>
      <div className="sheet">
        {Array.from({ length: 5 }, (_, i) => (
          <div className="row sk-row" key={i}><div className="sk sk-line" style={{ width: `${70 - i * 8}%` }} /></div>
        ))}
      </div>
      <p className="help" aria-hidden="true">Fetching formats from {platform}…</p>
    </div>
  );
}

export function PlaylistChoice({ onVideo, onPlaylist, which }: { onVideo: () => void; onPlaylist: () => void; which: "video" | "playlist" }) {
  return (
    <div className="choice" role="group" aria-label="This link is part of a playlist">
      <span>This link is part of a playlist.</span>
      <div className="seg seg-sm" role="radiogroup" aria-label="What to fetch">
        <button role="radio" aria-checked={which === "video"} onClick={onVideo}>This video</button>
        <button role="radio" aria-checked={which === "playlist"} onClick={onPlaylist}>Whole playlist</button>
      </div>
    </div>
  );
}

export type ListQuality = "best" | "1080" | "720" | "480" | "audio" | "mp3";

export function ListPicker({ media, compat, onCompat, onDownload }: {
  media: ListMedia;
  compat: boolean;
  onCompat: (v: boolean) => void;
  onDownload: (indexes: number[], q: ListQuality) => void;
}) {
  const usable = useMemo(() => media.entries.filter((e) => e.has_video || media.kind === "playlist"), [media]);
  const [sel, setSel] = useState<Set<number>>(() => new Set(media.kind === "carousel" ? usable.map((e) => e.index) : usable.slice(0, 100).map((e) => e.index)));
  const [q, setQ] = useState<ListQuality>("best");
  const all = sel.size === usable.length;
  const noun = media.kind === "carousel" ? "item" : "video";
  const skipped = media.entries.length - usable.length;
  return (
    <section className="list" aria-labelledby="list-h">
      <div className="list-head">
        <div>
          <h2 id="list-h" className="title" dir="auto">{media.title}</h2>
          <p className="sub">
            {media.uploader ? <span dir="auto">{media.uploader}, </span> : null}
            {media.count} {media.count === 1 ? noun : `${noun}s`}
            {media.count > media.entries.length ? `, showing the first ${media.entries.length}` : ""}
          </p>
        </div>
        <button className="btn btn-quiet" onClick={() => setSel(all ? new Set() : new Set(usable.map((e) => e.index)))}>
          {all ? "Select none" : "Select all"}
        </button>
      </div>
      {skipped > 0 && <p className="help">{skipped} {skipped === 1 ? "item has" : "items have"} no video the engine can fetch (photos aren't supported), so {skipped === 1 ? "it's" : "they're"} not listed.</p>}
      <ul className="entries" aria-label={`${media.kind === "carousel" ? "Items" : "Videos"} to download`}>
        {usable.map((e) => {
          const on = sel.has(e.index);
          return (
            <li key={e.index}>
              <label className={cx("entry", on && "entry-on")}>
                <input type="checkbox" checked={on} onChange={() => {
                  const n = new Set(sel);
                  if (on) n.delete(e.index); else n.add(e.index);
                  setSel(n);
                }} />
                <span className="mono idx">{e.index}</span>
                <span className="etitle" dir="auto">{e.title}</span>
                <span className="mono edur">{duration(e.duration)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="list-foot">
        <label className="field-inline">
          <span>Quality</span>
          <select className="select" value={q} onChange={(e) => setQ(e.target.value as ListQuality)}>
            <option value="best">Best available</option>
            <option value="1080">Up to 1080p</option>
            <option value="720">Up to 720p</option>
            <option value="480">Up to 480p</option>
            <option value="audio">Audio only, original</option>
            <option value="mp3">Audio only, MP3 320</option>
          </select>
        </label>
        {q !== "audio" && q !== "mp3" && (
          <button className="toggle" role="switch" aria-checked={compat} onClick={() => onCompat(!compat)}>
            <span className="track" aria-hidden="true" />Plays everywhere
          </button>
        )}
        <button className="btn btn-1" disabled={!sel.size} onClick={() => onDownload([...sel].sort((a, b) => a - b), q)}>
          Download {sel.size} {sel.size === 1 ? noun : `${noun}s`}
        </button>
      </div>
    </section>
  );
}
