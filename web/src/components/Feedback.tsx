import { useId, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { api, type ApiError } from "../lib/api";
import { cx } from "../lib/util";
import { Dialog } from "./Chrome";

const I = { size: 16, strokeWidth: 1.5, "aria-hidden": true } as const;

/** What happened, what to do next, ONE action, raw details behind a toggle. */
export function ErrorBlock({ error, local, onAction, embedded }: {
  error: ApiError; local: boolean; onAction: (a: string) => void; embedded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const id = useId();
  // Cookies only make sense when the engine runs on this person's own machine.
  const action = error.action === "cookies" && !local ? null : error.action;
  const hint = error.action === "cookies" && !local ? `${error.hint?.split(". ")[0]}. Try again later, or run SnagOtter on your own computer.` : error.hint;
  return (
    <div className={cx("err", embedded && "err-embedded")} role="alert">
      <p className="err-title">{error.title}</p>
      {hint && <p className="err-hint">{hint}</p>}
      <div className="row-actions">
        {action && error.action_label && (
          <button className="btn btn-2" onClick={() => onAction(action)}>{error.action_label}</button>
        )}
        {error.details && (
          <button className="linkbtn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
            <ChevronDown {...I} className={cx("chev", open && "chev-open")} />Details
          </button>
        )}
      </div>
      {error.details && (
        <div id={id} hidden={!open} className="err-details">
          <pre className="mono">{error.details}</pre>
          <button className="btn btn-quiet btn-sm" onClick={() => navigator.clipboard?.writeText(error.details ?? "").then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {})}>
            {copied ? <Check {...I} /> : <Copy {...I} />}{copied ? "Copied" : "Copy details"}
          </button>
        </div>
      )}
    </div>
  );
}

const BROWSERS = [
  ["firefox", "Firefox"], ["chrome", "Chrome"], ["edge", "Edge"], ["brave", "Brave"],
  ["safari", "Safari"], ["opera", "Opera"], ["vivaldi", "Vivaldi"], ["chromium", "Chromium"],
] as const;

export function CookiesDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const win = /Win/.test(navigator.userAgent);
  const [how, setHow] = useState<"browser" | "file">("browser");
  const [browser, setBrowser] = useState<string>("firefox");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Use your own cookies" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        setBusy(true);
        try {
          if (how === "browser") await api.cookiesBrowser(browser);
          else if (file) await api.cookiesFile(file);
          else throw new Error("Choose a cookies.txt file first.");
          onDone();
        } catch (x) {
          setErr((x as Error).message);
        } finally {
          setBusy(false);
        }
      }}>
        <p className="prose-p">
          The site wants a signed-in visitor. With your cookies, the engine sees exactly what you see when you're logged in.
          They stay in the engine's memory on this computer and are only sent to that site.
        </p>
        <div className="seg" role="radiogroup" aria-label="Where the cookies come from">
          <button type="button" role="radio" aria-checked={how === "browser"} onClick={() => setHow("browser")}>From my browser</button>
          <button type="button" role="radio" aria-checked={how === "file"} onClick={() => setHow("file")}>cookies.txt file</button>
        </div>
        {how === "browser" ? (
          <label className="field">
            <span>Browser you're signed in with</span>
            <select className="select" value={browser} onChange={(e) => setBrowser(e.target.value)}>
              {BROWSERS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            {win && (browser === "chrome" || browser === "edge" || browser === "brave") && (
              <small>On Windows, Chrome-based browsers lock their cookies while open and often encrypt them. If it fails, use Firefox or a cookies.txt file.</small>
            )}
          </label>
        ) : (
          <label className="field">
            <span>cookies.txt (Netscape format)</span>
            <input className="input" type="file" accept=".txt,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <small>Export it with a browser extension while signed in to the site.</small>
          </label>
        )}
        {err && <p className="help help-err" role="alert">{err}</p>}
        <div className="row-actions end">
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-1" disabled={busy}>{busy ? "Saving…" : "Use cookies and try again"}</button>
        </div>
      </form>
    </Dialog>
  );
}
