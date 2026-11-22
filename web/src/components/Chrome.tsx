import { useEffect, useRef, useState } from "react";
import { Check, Copy, Moon, Settings, Sun, X } from "lucide-react";
import { api, connect, fallbackEngine, setSavedEngineUrl, type Doctor } from "../lib/api";
import { getTheme, setTheme } from "../lib/store";

const I = { size: 18, strokeWidth: 1.5, "aria-hidden": true } as const;
const REPO = import.meta.env.VITE_REPO_URL as string | undefined;

export function TopBar({ doctor, offline, onSettings }: { doctor: Doctor | null; offline: boolean; onSettings: () => void }) {
  const [theme, setT] = useState(getTheme());
  const state = offline ? "off" : !doctor ? "wait" : doctor.ok ? "ok" : "warn";
  const text = { off: "Engine not connected", wait: "Connecting…", ok: "Engine ready", warn: "Engine needs attention" }[state];
  return (
    <header className="top">
      <div className="wrap">
        <a className="mark" href="/" aria-label="ytdown, start over">ytdown</a>
        <div className="spacer" />
        <div className="status" role="status" aria-label={text}>
          <span className={`dot dot-${state}`} aria-hidden="true" />
          <span className="txt" aria-hidden="true">{text}</span>
          {doctor && <span className="mono txt ver" aria-hidden="true">{doctor.engine.version}</span>}
        </div>
        <button className="iconbtn" onClick={onSettings} aria-label="Settings">
          <Settings {...I} />
        </button>
        <button
          className="iconbtn"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={() => {
            const n = theme === "dark" ? "light" : "dark";
            setTheme(n);
            setT(n);
          }}
        >
          {theme === "dark" ? <Sun {...I} /> : <Moon {...I} />}
        </button>
      </div>
    </header>
  );
}

export function Footer({ doctor, onAbout }: { doctor: Doctor | null; onAbout: () => void }) {
  const ff = doctor?.tools.ffmpeg;
  return (
    <footer>
      <div className="wrap">
        <span className="mono">ytdown {doctor?.app_version ?? "0.1.0"}</span>
        <span>
          {doctor ? (
            <>
              Engine <span className="mono">yt-dlp {doctor.engine.version}</span>
              {ff?.found ? ", ffmpeg found" : ", ffmpeg missing"}
            </>
          ) : (
            "Engine not connected"
          )}
        </span>
        <span className="grow">Only download content you have the right to use.</span>
        <span className="by">Made by Aahil Riyaz Beekay</span>
        <button className="linkbtn" onClick={onAbout}>About</button>
        {REPO && <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>}
      </div>
    </footer>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="About ytdown" onClose={onClose}>
      <div className="prose">
        <p>ytdown is a free downloader for YouTube, Instagram, TikTok, X and most other video sites. It has no accounts, ads or tracking.</p>
        <p>
          The work happens in an engine on your own computer, built on{" "}
          <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noreferrer">yt-dlp</a> and{" "}
          <a href="https://ffmpeg.org" target="_blank" rel="noreferrer">ffmpeg</a>. Links and files never pass through anyone else's server.
          Your Recent list stays in this browser.
        </p>
        <p>Only download content you have the right to use.</p>
        <p className="help">Made by Aahil Riyaz Beekay.</p>
      </div>
    </Dialog>
  );
}

/** One quiet line under the top bar: offline, missing tools, or a stale engine. */
export function Banner({ doctor, online, onUpdated }: { doctor: Doctor | null; online: boolean; onUpdated: (d: Doctor | null) => void }) {
  const [busy, setBusy] = useState<"idle" | "updating" | "restart" | "failed">("idle");
  if (!online) {
    return (
      <div className="banner" role="status">
        <div className="wrap"><span className="bdot" aria-hidden="true" /><span className="btext">You're offline. Links can't be fetched until you reconnect.</span></div>
      </div>
    );
  }
  if (!doctor) return null;
  const problem = doctor.problems[0];
  if (!problem && !doctor.engine.stale) return null;
  const update = async () => {
    setBusy("updating");
    try {
      const r = await api.update();
      if (!r.ok) return setBusy("failed");
      if (r.restart_required) return setBusy("restart");
      // wait until the old engine has gone away and the new one answers
      let sawDown = false;
      for (let i = 0; i < 60; i++) {
        await new Promise((res) => setTimeout(res, 1000));
        const d = await connect();
        if (!d) sawDown = true;
        else if (sawDown || d.engine.version !== doctor.engine.version) {
          setBusy("idle");
          return onUpdated(d);
        }
      }
      setBusy("restart");
    } catch {
      setBusy("failed");
    }
  };
  const text = problem
    ? problem.text
    : `The download engine is ${doctor.engine.age_days} days old. Sites change often, and updating keeps links working.`;
  const canFix = doctor.can_update && (!problem || problem.code === "ejs");
  return (
    <div className="banner" role="status">
      <div className="wrap">
        <span className="bdot" aria-hidden="true" />
        <span className="btext">
          {busy === "updating" ? "Updating the engine… this takes about a minute." :
            busy === "restart" ? "Updated. Restart ytdown to finish." :
            busy === "failed" ? "The update didn't work. Check your connection and try again." : text}
        </span>
        {canFix && busy !== "restart" && (
          <button className="btn btn-2 btn-sm" onClick={update} disabled={busy === "updating"}>
            {busy === "updating" ? "Updating…" : "Update engine"}
          </button>
        )}
      </div>
    </div>
  );
}

function CopyLine({ cmd, label }: { cmd: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="cmd">
      <code className="mono">{cmd}</code>
      <button
        className="iconbtn"
        aria-label={done ? "Copied" : `Copy the ${label} command`}
        onClick={() => navigator.clipboard?.writeText(cmd).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }, () => {})}
      >
        {done ? <Check {...I} /> : <Copy {...I} />}
      </button>
    </div>
  );
}

/** Shown when the page can't reach any engine (e.g. the Vercel-hosted PWA with nothing running locally). */
export function ConnectEngine({ onRetry, checking }: { onRetry: () => void; checking: boolean }) {
  const win = /Win/.test(navigator.userAgent);
  const mobile = /Android|iPhone|iPad/.test(navigator.userAgent);
  return (
    <section className="connect" aria-labelledby="connect-h">
      <h1 id="connect-h">Start the engine.</h1>
      <p className="lede">
        ytdown downloads on your own computer, so sites see a normal home connection instead of a server.
        This page looks for the engine at <span className="mono">{fallbackEngine()}</span>, and it isn't answering.
      </p>
      {mobile ? (
        <p className="lede">
          On a phone, run the engine on a computer on the same Wi-Fi, then put that computer's address in Settings.
        </p>
      ) : (
        <ol className="steps-list">
          <li>
            <span>In the ytdown folder, start it. The first run installs what it needs:</span>
            <CopyLine label="start" cmd={win ? ".\\start.ps1" : "./start.sh"} />
          </li>
          <li>
            <span>Or with Docker:</span>
            <CopyLine label="Docker" cmd="docker compose up -d" />
          </li>
        </ol>
      )}
      <div className="row-actions">
        <button className="btn btn-1" onClick={onRetry} disabled={checking}>{checking ? "Checking…" : "Check again"}</button>
        <a className="btn btn-quiet" href="http://127.0.0.1:8787">Open the local app</a>
      </div>
      <p className="help">Safari doesn't let websites reach your own computer. Use the local app link instead.</p>
    </section>
  );
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="dlg-title" onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="dialog-in">
        <div className="dialog-head">
          <h2 id="dlg-title">{title}</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><X {...I} /></button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function SettingsDialog({ doctor, onClose, onChanged }: { doctor: Doctor | null; onClose: () => void; onChanged: () => void }) {
  const [engine, setEngine] = useState(fallbackEngine());
  const [channel, setChannel] = useState<"stable" | "nightly">(doctor?.engine.channel ?? "stable");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Settings" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          setSavedEngineUrl(engine.trim() || null);
          onChanged();
          onClose();
        }}
      >
        <label className="field">
          <span>Engine address</span>
          <input className="input mono" value={engine} onChange={(e) => setEngine(e.target.value)} inputMode="url" spellCheck={false} autoComplete="off" />
          <small>Where this page finds the engine. Keep <span className="mono">http://127.0.0.1:8787</span> unless you run it somewhere else.</small>
        </label>
        {doctor?.can_update && (
          <fieldset className="field">
            <legend>Engine channel</legend>
            <div className="seg" role="radiogroup" aria-label="Engine channel">
              {(["stable", "nightly"] as const).map((c) => (
                <button type="button" key={c} role="radio" aria-checked={channel === c} onClick={() => setChannel(c)}>
                  {c === "stable" ? "Stable" : "Nightly"}
                </button>
              ))}
            </div>
            <small>Nightly gets site fixes days earlier. Stable changes less often.</small>
            <div className="row-actions">
              <button type="button" className="btn btn-2" disabled={busy} onClick={async () => {
                setBusy(true);
                setMsg("Updating… this takes about a minute.");
                try {
                  const r = await api.update(channel);
                  setMsg(r.ok ? (r.restarting ? "Updated. The engine is restarting." : "Updated. Restart ytdown to finish.") : "The update didn't work.");
                } catch (err) {
                  setMsg((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}>
                {busy ? "Updating…" : `Update to the latest ${channel} engine`}
              </button>
            </div>
            {msg && <p className="help" role="status">{msg}</p>}
          </fieldset>
        )}
        {doctor && (
          <dl className="kv">
            <dt>Engine</dt><dd className="mono">yt-dlp {doctor.engine.version}{doctor.engine.ejs ? `, ejs ${doctor.engine.ejs}` : ""}</dd>
            <dt>ffmpeg</dt><dd className="mono">{doctor.tools.ffmpeg?.found ? doctor.tools.ffmpeg.version ?? "found" : "missing"}</dd>
            <dt>JavaScript</dt><dd className="mono">{doctor.tools.node?.ok ? `Node ${doctor.tools.node.version}` : doctor.tools.deno?.ok ? `Deno ${doctor.tools.deno.version}` : "missing"}</dd>
            <dt>Cookies</dt>
            <dd>
              {doctor.cookies ? `Using your ${doctor.cookies === "file" ? "cookies.txt" : "browser cookies"}` : "Not used"}
              {doctor.cookies && <button type="button" className="linkbtn" onClick={() => api.clearCookies().then(onChanged)}>Forget them</button>}
            </dd>
          </dl>
        )}
        <div className="row-actions end">
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-1">Save</button>
        </div>
      </form>
    </Dialog>
  );
}
