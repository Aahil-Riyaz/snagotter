import { forwardRef, useState } from "react";
import { ClipboardPaste, X } from "lucide-react";
import type { Platform } from "../lib/api";
import { PLATFORM_NAME, cx, splitLinks } from "../lib/util";

const I = { size: 18, strokeWidth: 1.5, "aria-hidden": true } as const;

interface Props {
  value: string;
  platform: Platform | null;
  invalid: boolean;
  busy: boolean;
  primary: boolean; // Fetch is the primary action only while nothing is loaded
  onChange: (v: string) => void;
  onSubmit: (v?: string) => void;
  onClear: () => void;
}

export const LinkSlot = forwardRef<HTMLInputElement, Props>(function LinkSlot(
  { value, platform, invalid, busy, primary, onChange, onSubmit, onClear },
  ref,
) {
  const [hint, setHint] = useState<string | null>(null);
  const count = splitLinks(value).length;
  const stamp = count > 1 ? `${count} links` : platform ? PLATFORM_NAME[platform] : "Link";

  const paste = async () => {
    setHint(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return setHint("Your clipboard is empty.");
      onChange(text.trim());
      onSubmit(text.trim());
    } catch {
      setHint(/Mac|iPhone|iPad/.test(navigator.userAgent)
        ? "Your browser didn't allow reading the clipboard. Press ⌘V in the box instead."
        : "Your browser didn't allow reading the clipboard. Press Ctrl+V in the box instead.");
    }
  };

  return (
    <div>
      <form
        className={cx("slot", invalid && "slot-invalid")}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        role="search"
      >
        <span className={cx("stamp", (platform || count > 1) && "on")} aria-hidden="true">{stamp}</span>
        <label htmlFor="link" className="sr">Media link</label>
        <input
          ref={ref}
          id="link"
          type="text"
          inputMode="url"
          enterKeyHint="go"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Paste a video, Reel or playlist link"
          value={value}
          aria-invalid={invalid || undefined}
          aria-describedby="link-help"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && value) {
              e.preventDefault();
              onClear();
            }
          }}
        />
        <div className="acts">
          {value ? (
            <button type="button" className="btn btn-quiet btn-icon" onClick={onClear} aria-label="Clear link">
              <X {...I} />
            </button>
          ) : (
            // Empty box: Paste is the main action (a disabled Fetch would look broken).
            <button type="button" className={cx("btn", primary ? "btn-1 btn-paste" : "btn-2")} onClick={paste}>
              <ClipboardPaste {...I} />
              Paste
            </button>
          )}
          {(value || !primary) && (
            <button type="submit" className={cx("btn", primary ? "btn-1" : "btn-2")} disabled={busy || !value.trim()}>
              {busy ? "Fetching…" : count > 1 ? `Queue ${count}` : "Fetch"}
            </button>
          )}
        </div>
      </form>
      <p id="link-help" className={cx("help", invalid && "help-err")} aria-live="polite">
        {hint ??
          (invalid
            ? "That doesn't look like a link. Paste a full address, like youtube.com/watch?v=…"
            : primary ? "Tip: paste several links, one per line, to queue them." : "Paste several links, one per line, to queue them.")}
      </p>
    </div>
  );
});
