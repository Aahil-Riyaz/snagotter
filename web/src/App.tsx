import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, connect, EngineError, watchJob, type ApiError, type Doctor, type JobRequest, type JobSnap, type ListMedia, type Media, type Platform, type SingleMedia } from "./lib/api";
import { prefs, recent, type RecentItem } from "./lib/store";
import { PLATFORM_NAME, cx, detect, duration, isIOS, splitLinks } from "./lib/util";
import { AboutDialog, Banner, ConnectEngine, Footer, SettingsDialog, TopBar } from "./components/Chrome";
import { CookiesDialog, ErrorBlock } from "./components/Feedback";
import { Handles, JobFocus, Queue, Recent, type JobMeta } from "./components/Jobs";
import { LinkSlot } from "./components/Link";
import { ListPicker, MediaHeader, PlaylistChoice, Skeleton, type ListQuality } from "./components/Media";
import { AudioSheet, Controls, MoreOptions, SpecSheet, StickyBar, Summary, defaultSel, groupEnabled, pickVariant, resolve, type Sel } from "./components/Picker";

type View =
  | { k: "idle" }
  | { k: "fetching"; platform: Platform }
  | { k: "error"; error: ApiError; url: string }
  | { k: "single"; media: SingleMedia }
  | { k: "list"; media: ListMedia; choice: SingleMedia["playlist_choice"] }
  | { k: "batch"; ids: string[] };

type Meta = JobMeta & { sub: string };

export default function App() {
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [engine, setEngine] = useState<"checking" | "ok" | "offline">("checking");
  const [online, setOnline] = useState(navigator.onLine);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [view, setView] = useState<View>({ k: "idle" });
  const [sel, setSel] = useState<Sel | null>(null);
  const [jobs, setJobs] = useState<Record<string, JobSnap>>({});
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [recentItems, setRecent] = useState<RecentItem[]>(recent.list());
  const [dialog, setDialog] = useState<null | "settings" | "about" | "cookies">(null);
  const [listCompat, setListCompat] = useState(prefs.get().compat);
  const autoSaved = useRef(new Set<string>());
  const seen = useRef(new Set<string>());
  const unsub = useRef(new Map<string, () => void>());
  const inputRef = useRef<HTMLInputElement>(null);
  const lastUrl = useRef<string>("");
  const pendingShare = useRef<string | null>(null);

  const local = doctor?.mode !== "hosted";
  const platform = useMemo(() => (text.trim() ? detect(text.trim().split(/\s+/)[0]) : null), [text]);

  // ---------------------------------------------------------------- engine
  const reconnect = useCallback(async () => {
    setEngine("checking");
    const d = await connect();
    setDoctor(d);
    setEngine(d ? "ok" : "offline");
    return d;
  }, []);

  useEffect(() => {
    // PWA share target: /?url=… or /?text=…
    const q = new URLSearchParams(location.search);
    const link = splitLinks(q.get("url") || q.get("text") || "")[0];
    if (link) {
      pendingShare.current = link;
      setText(link);
      history.replaceState(null, "", location.pathname);
    }
    reconnect();
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const subs = unsub.current;
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      subs.forEach((u) => u());
    };
  }, [reconnect]);

  // ---------------------------------------------------------------- jobs
  const onSnap = useCallback((s: JobSnap) => {
    setJobs((j) => ({ ...j, [s.id]: s }));
    if (s.status === "ready" && !autoSaved.current.has(s.id) && !seen.current.has(s.id)) {
      seen.current.add(s.id);
      // On iPhone a download lands in Files; the job card offers "Save to Photos" instead.
      if (!isIOS()) {
        autoSaved.current.add(s.id);
        const a = document.createElement("a");
        a.href = api.fileUrl(s.id);
        a.download = s.filename ?? "";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setRecent(recent.add({
        id: s.id, title: s.title ?? s.filename ?? s.url, url: s.url, platform: detect(s.url) ?? "other",
        filename: s.filename, size: s.size, at: Date.now(),
      }));
    }
  }, []);

  const startJob = useCallback(async (req: JobRequest, m: Meta) => {
    const r = await api.createJob(req);
    setJobs((j) => ({ ...j, [r.job.id]: r.job }));
    setMeta((x) => ({ ...x, [r.job.id]: m }));
    setOrder((o) => [...o, r.job.id]);
    unsub.current.set(r.job.id, watchJob(r.job.id, onSnap));
    return r.job_id;
  }, [onSnap]);

  // ---------------------------------------------------------------- fetching
  const fetchInfo = useCallback(async (url: string, keepChoice?: SingleMedia["playlist_choice"]) => {
    lastUrl.current = url;
    setFocus(null);
    setView({ k: "fetching", platform: detect(url) ?? "other" });
    try {
      const media: Media = await api.info(url);
      if (lastUrl.current !== url) return;
      if (media.kind === "single") {
        const p = prefs.get();
        setSel(defaultSel(media, p.compat, p.mode));
        setView({ k: "single", media });
      } else {
        setView({ k: "list", media, choice: keepChoice ?? media.playlist_choice });
      }
    } catch (e) {
      if (lastUrl.current !== url) return;
      const err: ApiError = e instanceof EngineError ? e.error
        : { code: "unknown", title: "Something went wrong.", hint: "Try again.", action: "retry", action_label: "Try again", details: String(e) };
      if (err.code === "engine_offline") setEngine("offline");
      setView({ k: "error", error: err, url });
    }
  }, []);

  const submit = useCallback(async (raw?: string) => {
    const links = splitLinks((raw ?? text).trim());
    if (!links.length) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (links.length === 1) return fetchInfo(links[0]);
    // batch: every link goes into the queue with the default choice
    setFocus(null);
    const compat = prefs.get().compat;
    const ids: string[] = [];
    for (const url of links) {
      const p = PLATFORM_NAME[detect(url) ?? "other"];
      try {
        ids.push(await startJob({ url, mode: "av", compat }, {
          thumb: null, aspect: "16:9", platform: p, what: compat ? "Best MP4" : "Best quality",
          muxed: false, convert: false, gif: false, sub: p,
        }));
      } catch (e) {
        if (e instanceof EngineError && e.error.code === "engine_offline") {
          setEngine("offline");
          break;
        }
      }
    }
    setView({ k: "batch", ids });
    setText("");
  }, [text, fetchInfo, startJob]);

  useEffect(() => {
    if (engine === "ok" && pendingShare.current) {
      const u = pendingShare.current;
      pendingShare.current = null;
      fetchInfo(u);
    }
  }, [engine, fetchInfo]);

  const clear = () => {
    setText("");
    setInvalid(false);
    setView({ k: "idle" });
    setFocus(null);
    lastUrl.current = "";
    inputRef.current?.focus();
  };

  // ---------------------------------------------------------------- selection + download
  const single = view.k === "single" ? view.media : null;
  const resolved = useMemo(() => (single && sel ? resolve(single, sel) : null), [single, sel]);

  const setPart = (p: Partial<Sel>) => {
    if (!single || !sel) return;
    const next = { ...sel, ...p };
    if (p.compat !== undefined) prefs.set({ compat: p.compat });
    if (p.mode !== undefined) prefs.set({ mode: p.mode });
    if (p.compat !== undefined || p.mode !== undefined) {
      const cur = single.video.find((g) => g.key === next.groupKey);
      if (!cur || !groupEnabled(single, next, cur)) {
        const g = single.video.find((x) => groupEnabled(single, next, x));
        next.groupKey = g?.key ?? null;
        next.codec = g ? pickVariant(single, next, g)?.codec ?? null : null;
      } else {
        next.codec = pickVariant(single, next, cur)?.codec ?? null;
      }
    }
    setSel(next);
  };

  const download = useCallback(async () => {
    if (!single || !sel || !resolved?.ok || !resolved.req || starting) return;
    setStarting(true);
    const g = single.video.find((x) => x.key === sel.groupKey);
    const v = g ? pickVariant(single, sel, g) : null;
    try {
      const id = await startJob(resolved.req, {
        thumb: single.thumbnail, aspect: single.aspect, platform: PLATFORM_NAME[single.platform],
        what: resolved.short, muxed: sel.mode !== "audio" && !!v?.muxed, convert: !!resolved.req.convert,
        gif: !!resolved.req.options?.gif,
        sub: [single.uploader, duration(single.duration)].filter(Boolean).join(", "),
      });
      setFocus(id);
      window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    } catch (e) {
      if (e instanceof EngineError) setView({ k: "error", error: e.error, url: single.url });
    } finally {
      setStarting(false);
    }
  }, [single, sel, resolved, starting, startJob]);

  const downloadList = async (media: ListMedia, indexes: number[], q: ListQuality) => {
    const ids: string[] = [];
    const audio = q === "audio" || q === "mp3";
    for (const i of indexes) {
      const e = media.entries.find((x) => x.index === i)!;
      const req: JobRequest = {
        url: media.kind === "carousel" ? media.url : e.url,
        items: media.kind === "carousel" ? i : null,
        mode: audio ? "audio" : "av",
        compat: !audio && listCompat,
        max_height: q === "1080" ? 1080 : q === "720" ? 720 : q === "480" ? 480 : null,
        convert: q === "mp3" ? { codec: "mp3", bitrate: 320 } : null,
        title: e.title,
      };
      try {
        ids.push(await startJob(req, {
          thumb: e.thumbnail, aspect: media.platform === "youtube" ? "16:9" : "9:16", platform: PLATFORM_NAME[media.platform],
          what: audio ? (q === "mp3" ? "MP3 320" : "Original audio") : q === "best" ? "Best" : `Up to ${q}p`,
          muxed: false, convert: q === "mp3", gif: false, sub: media.title,
        }));
      } catch {
        /* the queue shows what started */
      }
    }
    setView({ k: "batch", ids });
  };

  const onAction = (a: string, url?: string) => {
    if (a === "retry") return url ? fetchInfo(url) : reconnect();
    if (a === "clear") return clear();
    if (a === "cookies") return setDialog("cookies");
    if (a === "update" || a === "doctor") return setDialog("settings");
    if (a === "open_link" && url) return window.open(url, "_blank", "noopener");
  };

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
    const onPaste = (e: ClipboardEvent) => {
      if (typing(e.target) || document.querySelector("dialog[open]")) return;
      const t = e.clipboardData?.getData("text")?.trim();
      if (!t || !splitLinks(t).length) return;
      e.preventDefault();
      setText(t);
      submit(t);
    };
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
      if ((e.key === "d" || e.key === "D") && single && !focus) {
        e.preventDefault();
        download();
      } else if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("paste", onPaste);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("keydown", onKey);
    };
  }, [submit, single, focus, download]);

  // ---------------------------------------------------------------- render
  const jobList = order.map((id) => jobs[id]).filter(Boolean);
  const focused = focus ? jobs[focus] : null;
  const loaded = view.k === "single" || view.k === "list";
  const cancel = (id: string) => { api.cancel(id).catch(() => {}); };

  const work = () => {
    if (focused && meta[focused.id]) {
      const m = meta[focused.id];
      return (
        <JobFocus
          job={focused} meta={m} local={local} autoSaved={autoSaved.current.has(focused.id)}
          title={focused.title ?? focused.url} sub={m.sub}
          onCancel={() => cancel(focused.id)}
          onAgain={() => setFocus(null)}
          onAction={(a) => {
            if (a === "save") { api.save(focused.id).then(onSnap).catch(() => {}); return; }
            if (a === "retry") { if (single) { setFocus(null); download(); } else fetchInfo(focused.url); return; }
            onAction(a, focused.url);
          }}
        />
      );
    }
    switch (view.k) {
      case "fetching":
        return <Skeleton platform={PLATFORM_NAME[view.platform]} />;
      case "error":
        return <div className="after-slot"><ErrorBlock error={view.error} local={local} onAction={(a) => onAction(a, view.url)} /></div>;
      case "single": {
        const m = view.media;
        return (
          <>
            {m.playlist_choice && (
              <PlaylistChoice which="video" onVideo={() => {}} onPlaylist={() => fetchInfo(m.playlist_choice!.playlist_url, m.playlist_choice)} />
            )}
            <MediaHeader media={m} />
            {sel && resolved && (
              <>
                <Controls m={m} s={sel} set={setPart} />
                {sel.mode === "audio" ? <AudioSheet m={m} s={sel} set={setPart} /> : <SpecSheet m={m} s={sel} set={setPart} onCommit={download} />}
                {resolved.note && sel.mode === "audio" && <p className="honest" role="note">{resolved.note}</p>}
                <MoreOptions m={m} s={sel} set={setPart} r={resolved} />
              </>
            )}
          </>
        );
      }
      case "list":
        return (
          <>
            {view.choice && <PlaylistChoice which="playlist" onVideo={() => fetchInfo(view.choice!.video_url)} onPlaylist={() => {}} />}
            <ListPicker media={view.media} compat={listCompat}
              onCompat={(v) => { setListCompat(v); prefs.set({ compat: v }); }}
              onDownload={(idx, q) => downloadList(view.media, idx, q)} />
          </>
        );
      case "batch":
        return (
          <section className="after-slot batch">
            <h2>{view.ids.length} {view.ids.length === 1 ? "download" : "downloads"} queued</h2>
            <p className="help">Each one downloads at the best quality{prefs.get().compat ? " that plays everywhere (H.264 MP4)" : ""}. A few run at once, the rest wait their turn.</p>
            <Queue jobs={view.ids.map((id) => jobs[id]).filter(Boolean)} focus={null} onFocus={setFocus} />
          </section>
        );
      default:
        return (
          <div className="keys" aria-label="Keyboard shortcuts">
            <span><kbd>Ctrl</kbd><kbd>V</kbd> pastes from anywhere</span>
            <span><kbd>Enter</kbd> fetches formats</span>
            <span><kbd>↑</kbd><kbd>↓</kbd> choose a format</span>
            <span><kbd>D</kbd> downloads</span>
          </div>
        );
    }
  };

  const showSummary = !!(view.k === "single" && !focused && resolved && sel);

  return (
    <>
      <a className="skip" href="#link">Skip to the link box</a>
      <TopBar doctor={doctor} offline={engine === "offline"} onSettings={() => setDialog("settings")} />
      <Banner doctor={doctor} online={online} onUpdated={(d) => { setDoctor(d); setEngine(d ? "ok" : "offline"); }} />
      <main className={cx(showSummary && "has-sticky")}>
        <div className="wrap grid">
          {engine === "offline" ? (
            <div className="work"><ConnectEngine onRetry={reconnect} checking={false} /></div>
          ) : (
            <div className="work">
              <h1 className={cx((loaded || focused || view.k === "batch") && "sr")}>
                {focused ? "Downloading" : loaded ? "Choose a format" : "Paste a link."}
              </h1>
              <LinkSlot
                ref={inputRef}
                value={text}
                platform={platform}
                invalid={invalid}
                busy={view.k === "fetching"}
                primary={!loaded && !focused}
                onChange={(v) => { setText(v); if (invalid) setInvalid(false); }}
                onSubmit={submit}
                onClear={clear}
              />
              {work()}
            </div>
          )}
          <aside className="rail" aria-label="Downloads">
            {showSummary && <Summary r={resolved!} onDownload={download} busy={starting} local={local} />}
            <Queue jobs={jobList} focus={focus} onFocus={setFocus} />
            {!showSummary && view.k !== "list" && !focused && jobList.length === 0 && <Handles />}
            {!showSummary && <Recent items={recentItems} onClear={() => setRecent(recent.clear())} onOpen={(u) => { setText(u); fetchInfo(u); }} />}
          </aside>
        </div>
        {showSummary && <StickyBar r={resolved!} onDownload={download} busy={starting} />}
      </main>
      <Footer doctor={doctor} onAbout={() => setDialog("about")} />
      {dialog === "settings" && <SettingsDialog doctor={doctor} onClose={() => setDialog(null)} onChanged={() => { reconnect(); }} />}
      {dialog === "about" && <AboutDialog onClose={() => setDialog(null)} />}
      {dialog === "cookies" && (
        <CookiesDialog onClose={() => setDialog(null)} onDone={() => {
          setDialog(null);
          reconnect();
          if (view.k === "error") fetchInfo(view.url);
          else if (focused) fetchInfo(focused.url);
        }} />
      )}
    </>
  );
}
