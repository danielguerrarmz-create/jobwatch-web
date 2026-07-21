/**
 * A list of short strings, edited as removable chips.
 *
 * Keywords were originally a textarea, one per line. Chips are better here for a reason
 * that matters to this product: the list is the thing the matcher runs on, so seeing it as
 * discrete items makes it obvious that "product designer" is one keyword and not two, and
 * makes removing the one bad keyword a single click instead of a careful line edit.
 */

import { useRef, useState } from "react";

export function TagEditor({
  id,
  label,
  hint,
  values,
  placeholder,
  suggestions = [],
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  values: string[];
  placeholder?: string;
  /** Offered as one-click adds. Already-present values are filtered out by the caller. */
  suggestions?: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (raw: string) => {
    // Commas split so pasting "figma, sketch, rhino" does the obvious thing.
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const lower = new Set(values.map((v) => v.toLowerCase()));
    const additions = parts.filter((p) => {
      const key = p.toLowerCase();
      if (lower.has(key)) return false;
      lower.add(key);
      return true;
    });
    if (additions.length) onChange([...values, ...additions.map((a) => a.slice(0, 120))]);
    setDraft("");
  };

  const remove = (value: string) => onChange(values.filter((v) => v !== value));

  const unused = suggestions.filter(
    (s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="field tagfield">
      <label className="field__label" htmlFor={id}>
        {label}{" "}
        <span style={{ color: "var(--c-text-faint)", fontWeight: 400 }}>({values.length})</span>
      </label>
      {hint ? <p className="field__hint">{hint}</p> : null}

      {values.length > 0 ? (
        <ul className="taglist">
          {values.map((value) => (
            <li key={value}>
              <span className="tag">
                {value}
                <button
                  type="button"
                  className="tag__x"
                  onClick={() => remove(value)}
                  aria-label={`Remove ${value}`}
                >
                  &#10005;
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <input
        id={id}
        ref={inputRef}
        className="input"
        value={draft}
        placeholder={placeholder ?? "Type and press Enter"}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && values.length) {
            // Backspace on an empty box removes the last chip, the behavior every other
            // token input has trained people to expect.
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
      />

      {unused.length > 0 ? (
        <div className="suggestions">
          <span className="suggestions__label">From your resume:</span>
          <div className="taglist">
            {unused.slice(0, 24).map((s) => (
              <button
                key={s}
                type="button"
                className="tag tag--suggested"
                onClick={() => add(s)}
                aria-label={`Add ${s}`}
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
