import { siInstagram } from "simple-icons";

/** SnagOtter's sponsor. One place to change it. */
export const SPONSOR = {
  name: "Casa Arabia Design Studio",
  what: "Luxury interiors, wallpaper and fabrics in Bahrain.",
  url: "https://www.instagram.com/casa_arabia_design/",
  logo: "/brand/casa-arabia-crest.webp",
};

function IgIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={siInstagram.path} fill="currentColor" />
    </svg>
  );
}

const link = { href: SPONSOR.url, target: "_blank", rel: "noopener sponsored" } as const;

/** Home page: a small thank-you card. */
export function SponsorCard() {
  return (
    <section className="wrap sponsor" aria-label="Sponsor">
      <a className="sponsor-card reveal" {...link}>
        <img className="sponsor-logo" src={SPONSOR.logo} alt="" width={67} height={64} loading="lazy" decoding="async" />
        <span className="sponsor-text">
          <b>Kept free by {SPONSOR.name}</b>
          <span>No ads here, thanks to them. {SPONSOR.what}</span>
        </span>
        <span className="sponsor-follow"><IgIcon />Follow on Instagram</span>
      </a>
    </section>
  );
}

/** Ready screen: one quiet line under the download buttons. */
export function SponsorLine() {
  return (
    <a className="sponsor-line" {...link}>
      <img src={SPONSOR.logo} alt="" width={29} height={28} loading="lazy" decoding="async" />
      <span>Free thanks to <b>{SPONSOR.name}</b></span>
      <span className="sponsor-line-cta"><IgIcon size={15} />Follow</span>
    </a>
  );
}
