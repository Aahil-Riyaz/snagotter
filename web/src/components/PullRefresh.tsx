import { useEffect, useRef } from "react";
import { OTTER_SRC } from "./Brand";

const TRIGGER = 84; // px of (damped) pull needed to refresh
const MAX = 132;
const WORD = "SnagOtter";

/**
 * Branded pull-to-refresh for touch screens: the page slides down and reveals the otter,
 * which turns as you pull while "SnagOtter" appears letter by letter. Release past the
 * threshold and the otter spins while the page reloads. Updates go straight to the DOM
 * (CSS variable + transform), so there are no React re-renders while the finger moves.
 */
export function PullRefresh() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return; // touch events only fire on touch screens, so mice never trigger this
    const body = document.body;
    let startY = 0, startX = 0, dist = 0, active = false, busy = false;

    const paint = (d: number, animate = false) => {
      body.style.transition = animate ? "transform .45s cubic-bezier(.16,1,.3,1)" : "none";
      body.style.transform = d > 0 ? `translateY(${d}px)` : "";
      el.style.setProperty("--pull", String(Math.min(1, d / TRIGGER)));
      el.classList.toggle("ready", d >= TRIGGER);
    };
    const blocked = () => window.scrollY > 0 || busy || !!document.querySelector("dialog[open]");

    const onStart = (e: TouchEvent) => {
      if (blocked() || e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      active = true;
      dist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const dy = e.touches[0].clientY - startY;
      const dx = Math.abs(e.touches[0].clientX - startX);
      // Sideways swipe or the page scrolled: this isn't a pull, let the browser have it.
      if (window.scrollY > 0 || (dist === 0 && dx > 10 && dx > dy)) {
        if (dist) paint(0, true);
        active = false;
        dist = 0;
        return;
      }
      // Not (or no longer) pulling down: spring back but keep tracking, the finger may come back down.
      if (dy <= 0) {
        if (dist) paint(0, true);
        dist = 0;
        return;
      }
      e.preventDefault(); // we own the gesture while pulling down at the top
      dist = Math.min(MAX, dy * 0.5); // rubber-band feel
      paint(dist);
    };
    const onEnd = () => {
      if (!active) return;
      active = false;
      if (dist >= TRIGGER) {
        busy = true;
        el.classList.add("refreshing");
        paint(TRIGGER, true);
        window.setTimeout(() => location.reload(), 750);
      } else {
        paint(0, true);
      }
      dist = 0;
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
      body.style.transform = "";
      body.style.transition = "";
    };
  }, []);

  return (
    <div ref={ref} className="ptr" aria-hidden="true">
      <img src={OTTER_SRC} alt="" width={44} height={44} />
      <span className="ptr-word">
        {WORD.split("").map((c, i) => <span key={i} style={{ ["--i" as string]: i }}>{c}</span>)}
      </span>
    </div>
  );
}
