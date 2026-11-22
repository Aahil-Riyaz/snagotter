import type { JobSnap } from "../lib/api";
import { api } from "../lib/api";
import type { RecentItem } from "../lib/store";
import { PLATFORM_NAME, bytes, cx, duration, speed } from "../lib/util";
import { ErrorBlock } from "./Feedback";
import { MiniHeader } from "./Media";

export interface JobMeta {
  thumb: string | null;
  aspect: string;
  platform: string;
  what: string; // e.g. "1080p60 MP4"
  muxed: boolean;
  convert: boolean;
  gif: boolean;
}

type Step = [string, JobSnap["status"][]];

function stepsFor(job: JobSnap, meta: JobMeta): Step[] {
  if (job.mode === "audio")
    return [["Fetch", ["queued", "fetching"]], ["Audio", ["downloading_audio", "downloading_video"]], [meta.convert ? "Convert" : "Extract", ["converting", "merging"]], ["Ready", ["ready"]]];
  if (job.mode === "video")
    return [["Fetch", ["queued", "fetching"]], ["Video", ["downloading_video", "downloading_audio"]], [meta.gif ? "GIF" : "Finish", ["converting", "merging"]], ["Ready", ["ready"]]];
  if (meta.muxed)
    return [["Fetch", ["queued", "fetching"]], ["Download", ["downloading_video", "downloading_audio"]], [meta.gif ? "GIF" : "Finish", ["merging", "converting"]], ["Ready", ["ready"]]];
  return [["Fetch", ["queued", "fetching"]], ["Video", ["downloading_video"]], ["Audio", ["downloading_audio"]], [meta.gif ? "GIF" : "Merge", ["merging", "converting"]], ["Ready", ["ready"]]];
}

const HEAD: Record<JobSnap["status"], string> = {
  queued: "Waiting in line",
  fetching: "Getting ready",
  downloading_video: "Downloading video",
  downloading_audio: "Downloading audio",
  merging: "Merging video and audio",
  converting: "Converting",
  ready: "Ready",
  failed: "Failed",
  cancelled: "Download cancelled",
};

export function statusText(j: JobSnap): string {
  if (j.status === "failed") return j.error?.title ?? "Failed";
  if (j.status.startsWith("downloading") && j.percent != null) return `${HEAD[j.status]}, ${Math.floor(j.percent)}%`;
  if (j.status === "ready") return j.size ? `Ready, ${bytes(j.size)}` : "Ready";
  return HEAD[j.status];
}

export function JobCard({ job, meta, local, onCancel, onAgain, onAction, autoSaved }: {
  job: JobSnap;
  meta: JobMeta;
  local: boolean;
  onCancel: () => void;
  onAgain: () => void;
  onAction: (a: string) => void;
  autoSaved: boolean;
}) {
  const steps = stepsFor(job, meta);
  let at = steps.findIndex(([, st]) => st.includes(job.status));
  if (job.status === "failed" || job.status === "cancelled") at = -1;
  const live = !["ready", "failed", "cancelled"].includes(job.status);
  const downloading = job.status.startsWith("downloading");
  const pct = job.percent ?? 0;
  return (
    <section className="job" aria-labelledby={`jh-${job.id}`}>
      <div className="job-head">
        <h2 id={`jh-${job.id}`}>{job.status === "failed" ? "Download failed" : HEAD[job.status]}</h2>
        <span className="mono job-what">{meta.what}</span>
      </div>

      {job.status !== "failed" && job.status !== "cancelled" && (
        <ol className="steps" aria-label="Stages">
          {steps.map(([name], i) => (
            <li key={name} className={cx(i < at && "done", i === at && job.status !== "ready" && "now", job.status === "ready" && "done")}
              aria-current={i === at ? "step" : undefined}>
              {name}
            </li>
          ))}
        </ol>
      )}

      {live && (
        <>
          <div className={cx("bar", !downloading && "bar-wait")} role="progressbar" aria-label={HEAD[job.status]}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloading && job.percent != null ? Math.round(pct) : undefined}
            aria-valuetext={downloading && job.percent != null ? `${Math.round(pct)} percent` : HEAD[job.status]}>
            <i style={downloading ? { width: `${pct}%` } : undefined} />
          </div>
          <div className="readout mono">
            <div className="pct" aria-hidden="true">{downloading && job.percent != null ? `${pct.toFixed(1)}%` : job.status === "queued" ? "–" : "…"}</div>
          </div>
          <div className="readout mono" aria-hidden="true">
            <div><b>{job.downloaded != null ? `${bytes(job.downloaded).replace(/ (MB|GB|KB)$/, "")} / ${bytes(job.total)}` : "–"}</b><span>downloaded</span></div>
            <div><b>{speed(job.speed)}</b><span>speed</span></div>
            <div><b>{job.eta != null ? duration(job.eta) : "–"}</b><span>left</span></div>
          </div>
          <div className="job-foot">
            <p className="small">{job.status === "merging" ? "Merging is a remux: the video is copied, not re-encoded." :
              job.status === "queued" ? "It starts when a slot frees up." : "You can keep using ytdown while this runs."}</p>
            <button className="btn btn-2" onClick={onCancel}>Cancel download</button>
          </div>
        </>
      )}

      {job.status === "ready" && (
        <div className="done-block">
          <p className="fname" dir="auto">{job.filename}</p>
          <p className="small" role="status">
            {job.saved_to ? `Saved to ${job.saved_to}` : autoSaved ? `Sent to your browser's downloads${job.size ? `, ${bytes(job.size)}` : ""}.` : `${bytes(job.size)}, ready to save.`}
          </p>
          <div className="row-actions">
            <a className="btn btn-1" href={api.fileUrl(job.id)} download={job.filename ?? true}>{autoSaved ? "Download again" : "Save file"}</a>
            {local && !job.saved_to && (
              <button className="btn btn-2" onClick={() => onAction("save")}>Save to the ytdown folder</button>
            )}
            {job.extras.includes("subtitles") && <a className="btn btn-quiet" href={api.fileUrl(job.id, "subtitles")}>Subtitles (.srt)</a>}
            {job.extras.includes("thumbnail") && <a className="btn btn-quiet" href={api.fileUrl(job.id, "thumbnail")}>Thumbnail</a>}
            <button className="btn btn-quiet" onClick={onAgain}>Pick another format</button>
          </div>
        </div>
      )}

      {job.status === "failed" && job.error && <ErrorBlock error={job.error} local={local} onAction={onAction} embedded />}
      {job.status === "cancelled" && (
        <div className="row-actions">
          <p className="small">Partial files were deleted.</p>
          <button className="btn btn-2" onClick={onAgain}>Pick a format again</button>
        </div>
      )}
      <span className="sr" aria-live="polite">{["ready", "failed", "cancelled", "merging", "converting"].includes(job.status) ? statusText(job) : ""}</span>
    </section>
  );
}

export function JobFocus(props: Parameters<typeof JobCard>[0] & { title: string; sub: string }) {
  const { meta } = props;
  return (
    <>
      <MiniHeader title={props.title} sub={props.sub} thumb={meta.thumb} aspect={meta.aspect} platform={meta.platform} />
      <JobCard {...props} />
    </>
  );
}

export function Queue({ jobs, focus, onFocus }: { jobs: JobSnap[]; focus: string | null; onFocus: (id: string) => void }) {
  if (!jobs.length) return null;
  const active = jobs.filter((j) => !["ready", "failed", "cancelled"].includes(j.status)).length;
  return (
    <section aria-labelledby="queue-h">
      <h2 id="queue-h">Queue {active ? <span className="count mono">{active} active</span> : null}</h2>
      <ul className="queue">
        {jobs.map((j) => (
          <li key={j.id} className={cx(!["ready", "failed", "cancelled"].includes(j.status) && "now", j.status === "failed" && "bad", j.status === "ready" && "ok")}>
            <button className="qbtn" onClick={() => onFocus(j.id)} aria-current={j.id === focus || undefined}>
              <span className="u" dir="auto">{j.title ?? j.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
              <span className="st">{statusText(j)}</span>
              {j.status.startsWith("downloading") && (
                <span className="minibar" aria-hidden="true"><i style={{ width: `${j.percent ?? 0}%` }} /></span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const rel = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return rel.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rel.format(-Math.round(s / 3600), "hour");
  return rel.format(-Math.round(s / 86400), "day");
}

export function Recent({ items, onClear, onOpen }: { items: RecentItem[]; onClear: () => void; onOpen: (url: string) => void }) {
  return (
    <section aria-labelledby="recent-h">
      <div className="sec-head">
        <h2 id="recent-h">Recent</h2>
        {items.length > 0 && <button className="linkbtn" onClick={onClear}>Clear</button>}
      </div>
      {items.length === 0 ? (
        <p className="empty-note">Downloads you finish show up here. The list stays in this browser.</p>
      ) : (
        <ul className="queue recent">
          {items.slice(0, 8).map((r) => (
            <li key={r.id}>
              <button className="qbtn" onClick={() => onOpen(r.url)} title="Fetch this link again">
                <span className="u" dir="auto">{r.title}</span>
                <span className="st">{PLATFORM_NAME[r.platform as keyof typeof PLATFORM_NAME] ?? r.platform}, {r.size ? bytes(r.size) : "done"}, {ago(r.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Handles() {
  const rows: [string, string][] = [
    ["YouTube", "Videos, Shorts, Music, finished live streams, playlists"],
    ["Instagram", "Reels, posts, carousels"],
    ["TikTok", "Videos and short links, without the watermark when one is offered"],
    ["X", "Videos and GIFs, including posts with several"],
    ["Facebook", "Public videos and Reels"],
    ["Other", "Most sites yt-dlp supports"],
  ];
  return (
    <section aria-labelledby="handles-h">
      <h2 id="handles-h">What it handles</h2>
      <ul className="handles">
        {rows.map(([a, b]) => <li key={a}><b>{a}</b><span>{b}</span></li>)}
      </ul>
    </section>
  );
}
