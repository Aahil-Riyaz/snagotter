// GEO (generative engine optimisation): AI crawlers and search engines mostly don't run JavaScript,
// so the facts about SnagOtter are also written into plain HTML at build time, from src/content/geo.json.
// - index.html gets the summary, FAQ and site links inside #root (React replaces them on load) + FAQPage JSON-LD
// - one static page per site (/tiktok-downloader/ ...) with its own title, description, FAQ and JSON-LD
// - llms.txt, sitemap.xml and robots.txt (AI crawlers allowed by name)
import type { Plugin } from "vite";
import geo from "./src/content/geo.json";

type QA = { q: string; a: string };
type Page = (typeof geo.pages)[number];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const today = () => new Date().toISOString().slice(0, 10);
const url = (slug = "") => `${geo.site}/${slug ? `${slug}/` : ""}`;
const ld = (data: object) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

const faqLd = (faq: QA[]) => ({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});

const faqHtml = (faq: QA[]) =>
  `<dl class="geo-faq">${faq.map((f) => `<dt>${esc(f.q)}</dt><dd>${esc(f.a)}</dd>`).join("")}</dl>`;

const siteLinks = () =>
  `<ul class="geo-links">${geo.pages.map((p) => `<li><a href="/${p.slug}/">${esc(p.site)} downloader</a></li>`).join("")}</ul>`;

/** Plain HTML shown to crawlers (and for a moment before the app loads). */
function homeStatic(): string {
  return `<main class="geo-static">
<h1>${esc(geo.name)}: free video downloader</h1>
<p>${esc(geo.summary)}</p>
<h2>Downloaders</h2>${siteLinks()}
<h2>Questions</h2>${faqHtml(geo.faq)}
<p>Made by ${esc(geo.author)}. Only download content you have the right to use.</p>
</main>`;
}

const PAGE_CSS = `
:root{--paper:#EEEDE8;--ink:#1B1A17;--ink-2:#4F4B43;--line:#D6D3CA;--accent:#FF5B1F;--accent-ink:#B8360A;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--paper:#171715;--ink:#ECEAE3;--ink-2:#AEAAA0;--line:#2E2D29;--accent:#FF6B30;--accent-ink:#FF8A5C}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 "Schibsted Grotesk",ui-sans-serif,system-ui,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:20px 20px 48px}
header{display:flex;justify-content:space-between;align-items:center;padding-bottom:16px;border-bottom:1px solid var(--line)}
.mark{font-weight:700;color:var(--ink);text-decoration:none;font-size:18px}
h1{font-size:clamp(28px,6vw,40px);line-height:1.1;letter-spacing:-.02em;margin:32px 0 12px}
h2{font-size:18px;margin:32px 0 8px}
.lede{color:var(--ink-2);font-size:18px;margin:0 0 20px}
.cta{display:inline-block;background:var(--accent);color:#1B1A17;font-weight:600;text-decoration:none;padding:12px 20px;border-radius:10px}
ol,ul{padding-left:20px}li{margin:4px 0}
dl{margin:0;border-top:1px solid var(--line)}dt{font-weight:600;padding-top:14px}dd{margin:4px 0 0;padding-bottom:14px;border-bottom:1px solid var(--line);color:var(--ink-2)}
a{color:var(--accent-ink)}footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--line);font-size:14px;color:var(--ink-2)}
footer ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px 16px}`;

function sitePage(p: Page): string {
  const steps = [
    `Copy the ${p.site} link (Share, then Copy link).`,
    `Open ${geo.name} and paste the link.`,
    "Press Fetch, keep the suggested quality or pick another.",
    "Press Download. On iPhone, tap Save to Photos.",
  ];
  const data = [
    faqLd(p.faq),
    {
      "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: geo.name, item: url() },
        { "@type": "ListItem", position: 2, name: `${p.site} downloader`, item: url(p.slug) },
      ],
    },
  ];
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} | ${esc(geo.name)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${url(p.slug)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(geo.name)}">
<meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${url(p.slug)}"><meta property="og:image" content="${geo.site}/icon-512.png">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>${PAGE_CSS}</style>
${data.map(ld).join("\n")}
</head><body><div class="wrap">
<header><a class="mark" href="/">${esc(geo.name)}</a><a href="/">Open the downloader</a></header>
<main>
<h1>${esc(p.h1)}</h1>
<p class="lede">${esc(p.lede)}</p>
<a class="cta" href="/">Download from ${esc(p.site)}</a>
<h2>How to download from ${esc(p.site)}</h2>
<ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<h2>What you can save</h2>
<ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
<h2>Questions</h2>${faqHtml(p.faq)}
<p>${esc(geo.summary)}</p>
</main>
<footer>
<p>Other downloaders:</p>${siteLinks()}
<p>Made by ${esc(geo.author)}. Free, no sign-up, no ads. Only download content you have the right to use.</p>
</footer>
</div></body></html>`;
}

function llmsTxt(): string {
  const qa = (faq: QA[]) => faq.map((f) => `- Q: ${f.q}\n  A: ${f.a}`).join("\n");
  return `# ${geo.name}

> ${geo.summary}

Made by ${geo.author}. Free, no sign-up, no ads, no tracking. Only download content you have the right to use.

## Pages
- [${geo.name} (the downloader)](${url()})
${geo.pages.map((p) => `- [${p.title}](${url(p.slug)}): ${p.description}`).join("\n")}

## Questions
${qa(geo.faq)}

${geo.pages.map((p) => `## ${p.site}\n${p.features.map((f) => `- ${f}`).join("\n")}\n${qa(p.faq)}`).join("\n\n")}

## Source
- https://github.com/Aahil-Riyaz/snagotter
`;
}

function sitemap(): string {
  const d = today();
  const locs = [url(), ...geo.pages.map((p) => url(p.slug))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((l, i) => `  <url><loc>${l}</loc><lastmod>${d}</lastmod><priority>${i ? "0.8" : "1.0"}</priority></url>`).join("\n")}
</urlset>
`;
}

// Search and AI crawlers, allowed by name so a later blanket rule can't shut them out by accident.
const CRAWLERS = ["Googlebot", "Bingbot", "Google-Extended", "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot",
  "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Applebot", "Applebot-Extended", "DuckDuckBot",
  "CCBot", "Amazonbot", "meta-externalagent"];

function robots(): string {
  return `${CRAWLERS.map((c) => `User-agent: ${c}\nAllow: /`).join("\n\n")}

User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${geo.site}/sitemap.xml
`;
}

export function geoPlugin(): Plugin {
  return {
    name: "snagotter-geo",
    transformIndexHtml(html) {
      return html
        .replace('<div id="root"></div>', `<div id="root">${homeStatic()}</div>`)
        .replace("</head>", `  ${ld(faqLd(geo.faq))}\n</head>`);
    },
    generateBundle() {
      for (const p of geo.pages) this.emitFile({ type: "asset", fileName: `${p.slug}/index.html`, source: sitePage(p) });
      this.emitFile({ type: "asset", fileName: "llms.txt", source: llmsTxt() });
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemap() });
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robots() });
    },
  };
}

export const GEO_SLUGS = geo.pages.map((p) => p.slug);
