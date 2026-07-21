/**
 * The two profile controls that are not lists: target seniority and work arrangement.
 *
 * Shared between the setup wizard and Settings so the two screens cannot drift into
 * describing the same setting differently, which is the usual way a wizard and a settings
 * page end up disagreeing about what an option means.
 */

import type { SeniorityPref, WorkMode } from "../lib/types";

const SENIORITY_OPTIONS: { value: SeniorityPref; label: string; sub: string }[] = [
  { value: "intern", label: "Internship", sub: "Interns and co-ops" },
  { value: "entry", label: "Early career", sub: "New grad, junior, associate" },
  { value: "mid", label: "Mid level", sub: "A few years in" },
  { value: "senior", label: "Senior", sub: "Senior, staff, lead" },
  { value: "any", label: "Any level", sub: "No preference" },
];

export function SeniorityPicker({
  value,
  onChange,
}: {
  value: SeniorityPref;
  onChange: (v: SeniorityPref) => void;
}) {
  return (
    <div className="field tagfield">
      <span className="field__label">Level you are aiming at</span>
      <p className="field__hint">
        This tilts the ranking, it does not filter. Company leveling is inconsistent enough
        that a "Senior" in a title is weak evidence, so a mismatched role moves down the list
        rather than disappearing from it.
      </p>
      <div className="radiorow" role="group" aria-label="Level you are aiming at">
        {SENIORITY_OPTIONS.map((o) => (
          <button
            key={o.value}
            className="radiocard"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            <span>{o.label}</span>
            <span className="radiocard__sub">{o.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const MODE_OPTIONS: { value: WorkMode; label: string; sub: string }[] = [
  { value: "remote", label: "Remote", sub: "Fully remote or distributed" },
  { value: "hybrid", label: "Hybrid", sub: "Some days in an office" },
  { value: "onsite", label: "On site", sub: "Based at a location" },
];

export function WorkModePicker({
  value,
  onChange,
}: {
  value: WorkMode[];
  onChange: (v: WorkMode[]) => void;
}) {
  const toggle = (mode: WorkMode) =>
    onChange(value.includes(mode) ? value.filter((m) => m !== mode) : [...value, mode]);

  return (
    <div className="field tagfield">
      <span className="field__label">Work arrangement</span>
      <p className="field__hint">
        Leave all off for no preference. Boards rarely publish this as a real field, so it is
        read out of the location text and can be wrong. It is a filter, so turning one on will
        hide postings whose wording is ambiguous.
      </p>
      <div className="radiorow" role="group" aria-label="Work arrangement">
        {MODE_OPTIONS.map((o) => (
          <button
            key={o.value}
            className="radiocard"
            aria-pressed={value.includes(o.value)}
            onClick={() => toggle(o.value)}
          >
            <span>{o.label}</span>
            <span className="radiocard__sub">{o.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
