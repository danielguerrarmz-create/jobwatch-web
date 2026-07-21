/** Small shared pieces: the mark, chips, and a focus-trapping modal. */

import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { FitBand } from "../lib/types";

/**
 * The Jobwatch mark: an aperture ring left open at the bottom.
 *
 * Inlined rather than an `<img>` so it inherits `currentColor` and renders in both themes
 * from one asset. Keep it in sync with `brand/logo-mark.svg`.
 *
 * An earlier version put a leader line projecting from the ring at the upper right, which
 * read unmistakably as the Mars glyph. Nothing here should project outward from the circle.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" fill="none" role="img" aria-label="Jobwatch">
      <path
        d="M 14.58 27.40 A 10 10 0 1 1 21.42 27.40"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="butt"
      />
    </svg>
  );
}

const BAND_LABEL: Record<FitBand, string> = {
  strong: "Strong",
  good: "Good",
  partial: "Partial",
  stretch: "Stretch",
};

export function MatchChip({ band, score }: { band: FitBand; score: number }) {
  return (
    <span className={`chip chip--${band}`} title={`Match score ${score}. Open the role to see which keywords matched.`}>
      {BAND_LABEL[band]} {score}
    </span>
  );
}

const FRESH_COPY = {
  fresh: { label: "Fresh", cls: "fresh", title: "Posted within 3 days" },
  ok: { label: "Recent", cls: "ok", title: "Posted within 2 weeks" },
  stale: { label: "Stale", cls: "stale", title: "Posted more than 2 weeks ago" },
  unknown: { label: "No date", cls: "unknown", title: "This board does not publish a posting date" },
} as const;

export function FreshnessChip({ level, days }: { level: keyof typeof FRESH_COPY; days: number | null }) {
  const copy = FRESH_COPY[level];
  const text = days === null ? copy.label : days <= 0 ? "Today" : days === 1 ? "1d" : `${days}d`;
  return (
    <span className={`chip chip--${copy.cls}`} title={copy.title}>
      {text}
    </span>
  );
}

/**
 * Modal with the accessibility basics done properly: Escape closes, focus moves in on open
 * and back to the trigger on close, Tab is trapped inside, and the backdrop is click-to-close
 * but only on the backdrop itself.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus() ?? ref.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      returnTo.current?.focus?.();
    };
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const focusable = ref.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={wide ? "modal modal--wide" : "modal"}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="modal__head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="modal__title">{title}</div>
          </div>
          <button className="btn btn--ghost" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Comma/newline separated text <-> string[]. Used by every keyword editor. */
export const listToText = (list: string[]): string => list.join("\n");
export const textToList = (text: string): string[] =>
  text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
