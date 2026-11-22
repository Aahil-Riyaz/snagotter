import { siFacebook, siInstagram, siTiktok, siX, siYoutube } from "simple-icons";
import type { Platform } from "../lib/api";

/** Mascot: Microsoft Fluent Emoji "Otter" (3D), MIT licence. */
export const OTTER_SRC = "/brand/otter-3d.png";

export function Logo() {
  return (
    <span className="logo">
      <img src={OTTER_SRC} alt="" width={30} height={30} decoding="async" />
      <span className="logo-word">Snag<b>Otter</b></span>
    </span>
  );
}

export type Site = { id: Exclude<Platform, "other">; name: string; path: string; color: string; dark?: boolean; tint?: string };

/** Official marks from Simple Icons (CC0). TikTok and X are black marks, so they follow the text colour. */
export const SITES: Site[] = [
  { id: "youtube", name: "YouTube", path: siYoutube.path, color: `#${siYoutube.hex}` },
  { id: "instagram", name: "Instagram", path: siInstagram.path, color: `#${siInstagram.hex}` },
  { id: "tiktok", name: "TikTok", path: siTiktok.path, color: `#${siTiktok.hex}`, dark: true, tint: "#25F4EE" },
  { id: "facebook", name: "Facebook", path: siFacebook.path, color: `#${siFacebook.hex}` },
  { id: "x", name: "X", path: siX.path, color: `#${siX.hex}`, dark: true },
];

export function SiteIcon({ site, size = 24 }: { site: Site; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false"
      style={{ color: site.dark ? "var(--ink)" : site.color }}>
      <path d={site.path} fill="currentColor" />
    </svg>
  );
}
