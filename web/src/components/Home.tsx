import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, Download, Images, Link2, Music2, ShieldCheck, Smartphone } from "lucide-react";
import geo from "../content/geo.json";
import type { Platform } from "../lib/api";
import { cx } from "../lib/util";
import { OTTER_SRC, SITES, SiteIcon } from "./Brand";
import { Faq } from "./Faq";

const I = { size: 22, strokeWidth: 1.75, "aria-hidden": true } as const;
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Headline: the site name cycles through the platforms; once a link is pasted it settles on that site. */
export function HeroHead({ platform }: { platform: Platform | null }) {
  const [i, setI] = useState(0);
  const known = SITES.find((s) => s.id === platform);
  useEffect(() => {
    if (known || reduced()) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % SITES.length), 2200);
    return () => window.clearInterval(t);
  }, [known]);
  const site = known ?? SITES[i];
  return (
    <div className="hero-head">
      <span className="hero-mini" aria-hidden="true"><img src={OTTER_SRC} alt="" width={88} height={88} decoding="async" /></span>
      <h1 className="hero-title">
        Snag any video from{" "}
        <span className="rot" aria-hidden="true">
          <span key={site.id} className="rot-word" style={{ color: site.dark ? "var(--ink)" : site.color }}>
            {site.name}
          </span>
        </span>
        <span className="sr">YouTube, Instagram, TikTok, Facebook and X</span>
      </h1>
      <p className="hero-sub">Paste a link, pick the quality, save it. Free, no sign-up, no ads.</p>
    </div>
  );
}

/** Logos under the link box. The one that matches the pasted link lights up. */
export function SiteRow({ platform }: { platform: Platform | null }) {
  return (
    <div className="site-row">
      <ul aria-label="Works with">
        {SITES.map((s) => (
          <li key={s.id} className={cx(platform === s.id && "on", platform && platform !== s.id && "dim")} title={s.name}
            style={{ ["--brand" as string]: s.dark ? "var(--ink)" : s.color }}>
            <SiteIcon site={s} size={20} />
            <span className="sr">{s.name}</span>
          </li>
        ))}
      </ul>
      <span className="site-more">and many more sites</span>
    </div>
  );
}

/** Desktop hero visual: the otter with the platform marks floating around it. */
export function HeroArt() {
  return (
    <div className="hero-art" aria-hidden="true">
      <div className="blob" />
      <img className="otter" src={OTTER_SRC} alt="" width={256} height={256} decoding="async" />
      {SITES.map((s, n) => (
        <span key={s.id} className={`bubble b${n}`}><SiteIcon site={s} size={26} /></span>
      ))}
    </div>
  );
}

/** Adds .is-in to .reveal elements as they scroll into view (once). */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = [...root.querySelectorAll<HTMLElement>(".reveal")];
    if (reduced() || !("IntersectionObserver" in window)) {
      els.forEach((e) => e.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return ref;
}

const STEPS = [
  { icon: Link2, t: "Copy the link", d: "In the app, tap Share, then Copy link." },
  { icon: ClipboardPaste, t: "Paste it here", d: "Tap Paste. SnagOtter finds every quality." },
  { icon: Download, t: "Save the file", d: "On iPhone, tap Save to Photos." },
];

const PERKS = [
  { icon: Smartphone, t: "Plays on every phone", d: "MP4 that works on iPhone, Android, TVs and editors." },
  { icon: Images, t: "Straight to Photos", d: "One tap on iPhone puts the video in your camera roll." },
  { icon: Music2, t: "Just the audio", d: "Save the sound as MP3, M4A or FLAC with cover art." },
  { icon: ShieldCheck, t: "No ads, no sign-up", d: "Nothing to install. Links aren't logged and files are deleted." },
];

export function HomeSections() {
  const ref = useReveal();
  return (
    <div className="home" ref={ref}>
      <section className="wrap demo" aria-labelledby="demo-h">
        <div className="demo-copy reveal">
          <h2 id="demo-h">Three taps. That's it.</h2>
          <ol className="demo-steps">
            {STEPS.map((s) => (
              <li key={s.t}>
                <span className="step-ic"><s.icon {...I} /></span>
                <span><b>{s.t}</b><span>{s.d}</span></span>
              </li>
            ))}
          </ol>
        </div>
        <figure className="demo-media reveal">
          <video src="/brand/demo.mp4?v=2" poster="/brand/demo.jpg?v=2" autoPlay muted loop playsInline preload="metadata"
            width={540} height={1168} aria-label="SnagOtter saving an Instagram Reel on a phone" />
        </figure>
      </section>

      <section className="wrap sites" aria-labelledby="sites-h">
        <h2 id="sites-h" className="reveal">Works where your videos are</h2>
        <div className="bento">
          {SITES.map((s, n) => {
            const page = geo.pages[n];
            return (
              <a key={s.id} href={`/${page.slug}/`} className={cx("tile reveal", n === 0 && "tile-lg")}
                style={{ ["--brand" as string]: s.tint ?? (s.dark ? "var(--ink)" : s.color) }}>
                <span className="tile-ic"><SiteIcon site={s} size={n === 0 ? 44 : 30} /></span>
                <span className="tile-name">{s.name}</span>
                <span className="tile-what">{page.features[0]}</span>
                <span className="tile-go">{page.site} downloader</span>
              </a>
            );
          })}
        </div>
      </section>

      <section className="perks" aria-label="Why SnagOtter">
        <ul className="wrap perk-list">
          {PERKS.map((p) => (
            <li key={p.t} className="reveal">
              <span className="perk-ic"><p.icon {...I} /></span>
              <b>{p.t}</b>
              <span>{p.d}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="wrap faq-sec" aria-label="Questions">
        <div className="faq-side reveal">
          <img src={OTTER_SRC} alt="" width={120} height={120} loading="lazy" decoding="async" />
          <p>Can't find your answer? SnagOtter is free and open source.</p>
          <a className="btn btn-2" href="https://github.com/Aahil-Riyaz/snagotter" target="_blank" rel="noreferrer">See the code on GitHub</a>
        </div>
        <div className="reveal"><Faq /></div>
      </section>
    </div>
  );
}
