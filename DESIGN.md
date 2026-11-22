# ytdown design system

The feel is a precise, calm tool, like a well-made Mac utility or a good audio app. The tool is the page. The memorable thing is **the link slot**: a large, tactile input that stamps the detected platform into its left edge as you paste. Everything else stays quiet and disciplined. The format table reads like a spec sheet.

Tokens live in `web/src/styles/tokens.css` (the mockups use `mockups/tokens.css`, which is the same file). Components use token names, never raw values.

Direction note: the UXKIN reference library wasn't connected for this pass, so these decisions come from the brief and first principles, not from comparing real sites.

---

## Color

One neutral scale per theme, **one accent** (signal orange) used only for the primary action, the current selection and progress, plus three status colours. All text pairs meet WCAG 2.2 AA (≥ 4.5:1). UI marks such as borders, the selection bar and the progress fill meet ≥ 3:1.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper` | `#EEEDE8` | `#171715` | page background: greyed newsprint, not cream. Dark is a deep warm neutral, not navy or pure black |
| `--surface` | `#F8F7F3` | `#1F1F1C` | the link slot, the spec sheet, popovers |
| `--sunken` | `#E4E2DB` | `#121210` | segmented control track, skeleton blocks, code wells |
| `--line` | `#D6D3CA` | `#2E2D29` | 1px hairlines between rows |
| `--line-strong` | `#858074` | `#75726A` | input borders, focusable edges (≥ 3.1:1 against paper and surface) |
| `--ink` | `#1B1A17` | `#ECEAE3` | primary text |
| `--ink-2` | `#4F4B43` | `#AEAAA0` | secondary text, column headers |
| `--ink-3` | `#666157` | `#8C887E` | tertiary/meta (≥ 4.67:1 on every background) |
| `--accent` | `#FF5B1F` | `#FF6B30` | primary button fill, progress fill, selected-row bar |
| `--on-accent` | `#1B1A17` | `#171715` | text on accent (ink on orange, 5.6:1). Never white |
| `--accent-mark` | `#D9480F` | `#FF6B30` | thin marks only: progress fill, selected-row bar (≥ 3.3:1) |
| `--accent-ink` | `#B8360A` | `#FF8A57` | accent used *as text or a thin mark* on paper (4.9:1 / 6.9:1) |
| `--accent-wash` | `#FF5B1F14` | `#FF6B301A` | selected row background (8–10% tint) |
| `--ok` | `#2C6E47` | `#6CC08D` | ready / saved / engine OK |
| `--warn` | `#7E5500` | `#E2B44A` | engine outdated, ≈ estimates notice |
| `--err` | `#A8231B` | `#F07A6F` | failures; kept clearly red so it never reads as the accent |
| `--focus` | `#1B1A17` | `#ECEAE3` | 2px focus ring + 2px paper offset (an ink ring, not a coloured one) |

Rules: no gradients, glows, blur or glass. The accent never sits on large areas. The only orange on a screen is the one button, the one selected row and the one moving bar.

## Typography

- **UI: Schibsted Grotesk** (400 / 500 / 600 / 700). A newspaper grotesk with firm, slightly condensed caps and good numerals. It gives the tool a printed, editorial voice without being a "display" font.
- **Data: IBM Plex Mono** (400 / 500) with `font-variant-numeric: tabular-nums` for resolution, fps, codec, bitrate, size, ETA, speed and percent. Mono is used *only* for real technical values, never for decorative labels.
- Both are self-hosted (`@fontsource`) so the PWA works offline. Fallbacks: `ui-sans-serif, system-ui` / `ui-monospace, "Cascadia Mono", Menlo`.

Scale (ratio ≈ 1.25, rounded to whole pixels):

| Token | Size / line-height | Use |
|---|---|---|
| `--t-xs` | 12 / 16 | badges (HDR, Best), legal footer line |
| `--t-sm` | 13 / 18 | column headers, meta, helper text |
| `--t-base` | 15 / 22 (16 / 24 under 600px) | body, table cells |
| `--t-md` | 17 / 24 | link slot text, segmented control, primary button |
| `--t-lg` | 21 / 28 | media title |
| `--t-xl` | 28 / 32 | screen heading ("Paste a link.") |
| `--t-2xl` | 40 / 42 | empty-state heading on desktop only |

Headings are weight 600 with letter-spacing −0.015em (−0.025em at 40px). Sentence case everywhere. No all-caps labels, no tracked eyebrows. Lines in prose are capped at 68ch.

## Spacing and layout

- 4px base: `--s-1 4` · `--s-2 8` · `--s-3 12` · `--s-4 16` · `--s-5 20` · `--s-6 24` · `--s-8 32` · `--s-10 40` · `--s-12 48` · `--s-16 64`.
- Desktop (≥ 1024px): 12-column grid, 24px gutters, max content width 1200px, **left-aligned** with a 64px left margin at 1440. The work column spans 8 columns and the rail (queue, recent, download summary) spans 4.
- Tablet (600–1023px): one column, the rail drops below the work column.
- Mobile (< 600px): 16px side padding. The spec table becomes stacked rows and a sticky download bar sits at the bottom (`padding-bottom: env(safe-area-inset-bottom)`).
- Touch targets are ≥ 44px on every viewport. Table rows are 48px tall.

## Shape and depth

- Radius: `--r-1 3px` (badges), `--r-2 6px` (buttons, inputs, rows, segmented control), `--r-3 8px` (panels, thumbnail). Nothing rounder than 8px except the toggle track (pill).
- Borders: 1px hairlines (`--line`). Inputs and the slot use `--line-strong`.
- Elevation: none, except **one** shadow for popovers and menus: `--shadow-pop: 0 1px 0 rgba(0,0,0,.04), 0 8px 24px -8px rgba(0,0,0,.18)` (dark: alpha .5). No cards inside cards. The spec sheet is one bordered surface with ruled rows.

## Motion

- `--ease: cubic-bezier(.2,.7,.2,1)` (ease-out). `--d-fast 120ms` hover and press, `--d-base 180ms` state changes and row selection, `--d-slow 220ms` panel reveal and "More options".
- One orchestrated moment: when info loads, the skeleton turns into the real layout in place (same boxes, so there's no layout shift).
- The progress bar width follows real `percent` with `transition: width 250ms linear` (one update every ~250ms from SSE), so it moves smoothly without ever leading the data.
- `prefers-reduced-motion: reduce` removes all transitions except opacity, and the progress bar jumps.

## Components

- **Link slot (hero):** 64px tall (56px on mobile), `--surface`, 1px `--line-strong`, `--r-2`. Left: the platform stamp, a 1px-bordered mono-free text label ("YouTube", "Instagram", "TikTok", "X", "Other site", or "Link" when empty) in `--ink-2`, which turns `--ink` once detected. Middle: the input at `--t-md`. Right: a quiet **Paste** button and the primary **Fetch** button. Focus puts an ink ring around the whole slot, not just the input.
- **Buttons:** *primary* uses an `--accent` fill, `--on-accent` text, weight 600, 44px min height, and no shadow. Hover darkens 6% and press moves 1px down. *Secondary* is `--surface` with a `--line-strong` border. *Quiet* is text in `--ink-2` with an underline on hover. Disabled uses `--sunken` with `--ink-3` text and the cursor stays default. The primary label always says what happens: "Download 1080p MP4 · 84 MB".
- **Segmented control:** a `--sunken` track holding 3 equal segments. The active segment is `--surface` with an `--ink` label and a 1px `--line` border. Arrow keys move between segments (radio group semantics).
- **Spec sheet:** header row in `--t-sm` `--ink-2`. Columns are Quality · fps · Codec · Container · Size, with all values in mono and right-aligned sizes. Rows have hairline dividers. Hover uses a `--sunken` tint at 50%. *Selected* rows get `--accent-wash` plus a 3px `--accent-mark` bar on the inside left edge. Codec variants are small inline choices inside the row (radio chips). The "Best" badge is a 1px `--ink` outline, not orange.
- **Toggle ("Plays everywhere"):** a 36×20 track. Off is `--line-strong`, on is `--ink` (not orange, because orange is reserved). There's always an inline explanation next to it.
- **Progress:** a 4px track in `--sunken` with an `--accent-mark` fill, and below it a mono readout of percent, speed, ETA and bytes done/total. The stage list (Fetching, Video, Audio, Merging, Ready) is a real sequence, so it gets step numbers.
- **Error block:** a left 3px `--err` bar, a title saying what happened, one sentence on what to do next, one action button, and a "Details" disclosure showing the raw message in a `--sunken` mono well with a Copy button.
- **Banner (doctor):** a single line on `--sunken` with a `--warn` dot, text, and one secondary button ("Update engine").

## Imagery and icons

- **Icons:** Lucide at 1.5px stroke, 18px (16px inline), `currentColor`. Used only where meaning needs it: paste, clipboard, check, x/cancel, chevron, alert, external, sun/moon. No icons in circles and no decorative icons.
- **Platforms:** neutral text labels only ("YouTube"). No brand colours and no logos.
- **Thumbnails:** shown at the true aspect ratio (16:9, 9:16 for Shorts/Reels/TikTok, 1:1 when unknown), `--r-3`, 1px `--line`, with a mono duration chip in the bottom right (ink at 80% with paper text). A missing thumbnail shows a `--sunken` block with the platform label, not a broken image.

## Voice

Short, specific and in sentence case. Say exactly what will happen. No "seamless", "effortless", "magic" and so on. Errors don't apologise and are never vague. Examples: "Paste a link." · "Fetching formats…" · "This video is private. Only its owner can download it." · "Converting above 160 kbps adds size, not quality."

## Footer (only)

Version · engine status · "Only download content you have the right to use." · "Made by Aahil Riyaz Beekay" · About · GitHub.
