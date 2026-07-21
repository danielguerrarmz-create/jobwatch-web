/**
 * First-run setup.
 *
 * Four steps, every one of them skippable, because the fastest useful version of this app
 * is "pick a track, scan" and the most accurate version is "paste your resume and tune the
 * keywords". Forcing everyone down the long path loses the people who just want to look at
 * jobs; hiding the long path leaves the matcher generic. So both exist, and the wizard says
 * plainly at each step what skipping costs.
 *
 * Everything chosen here is editable later in Settings, and the wizard says so, because the
 * main reason people abandon a setup flow is fear of getting it wrong permanently.
 */

import { useMemo, useState } from "react";
import { PACKS } from "../lib/catalog";
import { PRESETS, presetById } from "../lib/presets";
import { extractFromResume } from "../lib/extract";
import type { Extraction } from "../lib/extract";
import type { Profile, SeniorityPref, Source, WorkMode } from "../lib/types";
import { Mark } from "./ui";
import { TagEditor } from "./TagEditor";
import { SeniorityPicker, WorkModePicker } from "./ProfileFields";
import { AddCompany } from "./AddCompany";

const STEPS = ["Track", "Resume", "Target", "Companies"] as const;

export function Onboarding({
  sources,
  onDone,
}: {
  sources: Source[];
  onDone: (profile: Profile, packs: string[], custom: Source[]) => void;
}) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [packs, setPacks] = useState<string[]>([]);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  /** Employers added by name or link during setup, on top of whatever packs are picked. */
  const [custom, setCustom] = useState<Source[]>([]);

  const set = (patch: Partial<Profile>) =>
    setProfile((p) => (p ? { ...p, ...patch } : p));

  const countsByPack = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of sources) counts[s.pack] = (counts[s.pack] ?? 0) + 1;
    return counts;
  }, [sources]);

  const choosePreset = (id: string) => {
    const preset = presetById(id);
    setProfile({ ...preset.profile });
    setPacks(preset.packs);
    setStep(1);
  };

  /** Parsing happens locally and only when asked. The resume is never uploaded. */
  const parseResume = () => {
    if (!profile?.resume.trim()) return;
    const result = extractFromResume(profile.resume);
    setExtraction(result);
    set({ seniority: result.seniority });
  };

  const packCount = packs.reduce((n, p) => n + (countsByPack[p] ?? 0), 0);
  const totalCompanies = packCount + custom.length;

  if (!profile) {
    return (
      <div className="onboard">
        <Mark className="onboard__mark" />
        <h1 className="onboard__title">Jobwatch</h1>
        <p className="onboard__lede">
          Job postings read straight from the companies themselves, not from a job board.
          No account and no server: your resume, your keywords, and everything you save stay
          in this browser. The only thing that leaves is the request to each company's own
          job board, exactly as if you had opened their careers page yourself.
        </p>
        <section className="panel">
          <p className="stepnum">Step 1 of 4</p>
          <h2 className="panel__title">What kind of work are you looking for?</h2>
          <p className="panel__sub">
            This picks a starting set of keywords and companies. You can change all of it in
            the next three steps, and again later in Settings.
          </p>
          <div className="packgrid">
            {PRESETS.map((p) => (
              <button key={p.id} className="packcard" onClick={() => choosePreset(p.id)}>
                <span className="packcard__label">{p.label}</span>
                <span className="packcard__blurb">{p.blurb}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="onboard">
      <Mark className="onboard__mark" />
      <h1 className="onboard__title">Set up Jobwatch</h1>

      <div className="wizard__progress" role="presentation">
        {STEPS.map((label, i) => (
          <div key={label} className={i <= step ? "wizard__step wizard__step--done" : "wizard__step"} />
        ))}
      </div>

      {step === 1 ? (
        <section className="panel">
          <p className="stepnum">Step 2 of 4 &middot; optional</p>
          <h2 className="panel__title">Paste your resume</h2>
          <p className="panel__sub">
            Jobwatch reads it right here in your browser and suggests the job titles and
            skills to match on. It is much better at this than a generic keyword list because
            it uses your actual words.
          </p>

          <div className="privacynote">
            <span>
              <strong>This stays on your machine.</strong> Your resume is stored only in this
              browser and is never sent anywhere. There is no server to send it to. You can
              delete it on its own at any time from Settings, and backups leave it out unless
              you tick a box.
            </span>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="resume">
              Resume text
            </label>
            <p className="field__hint">
              Open your resume, select all, copy, and paste it here. Formatting does not
              matter. PDFs will not paste cleanly from some viewers, so if the result looks
              like nonsense, try copying from the original document instead.
            </p>
            <textarea
              id="resume"
              className="textarea resumebox"
              value={profile.resume}
              onChange={(e) => set({ resume: e.target.value })}
              placeholder="Paste the full text of your resume here."
              spellCheck={false}
            />
          </div>

          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
            <button className="btn" onClick={parseResume} disabled={!profile.resume.trim()}>
              Read my resume
            </button>
          </div>

          {extraction ? (
            <div className="extractsummary" style={{ marginTop: "var(--space-4)" }}>
              Found {extraction.titles.length} likely{" "}
              {extraction.titles.length === 1 ? "role" : "roles"} and {extraction.skills.length}{" "}
              {extraction.skills.length === 1 ? "skill" : "skills"}. {extraction.seniorityReason}{" "}
              You will confirm them on the next step.
            </div>
          ) : null}

          <div className="wizard__nav">
            <button className="btn btn--primary" onClick={() => setStep(2)}>
              Continue
            </button>
            <button className="btn btn--ghost" onClick={() => setStep(2)}>
              Skip, I will type keywords myself
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="panel">
          <p className="stepnum">Step 3 of 4</p>
          <h2 className="panel__title">What should count as a match?</h2>
          <p className="panel__sub">
            A keyword in a job <strong>title</strong> is worth three times the same keyword
            buried in the description. Matching is whole-word, so "designer" will not match
            "redesigner".
          </p>

          <TagEditor
            id="onb-titles"
            label="Roles you want"
            hint="The strongest signal. Job titles, not skills."
            values={profile.targetTitles}
            placeholder="e.g. Product Designer"
            suggestions={extraction?.titles.map((t) => t.value) ?? []}
            onChange={(targetTitles) => set({ targetTitles })}
          />

          <TagEditor
            id="onb-skills"
            label="Your skills"
            hint="Tools, languages, and methods you actually have. These break ties between similar roles."
            values={profile.skills}
            placeholder="e.g. Figma"
            suggestions={extraction?.skills.map((s) => s.value) ?? []}
            onChange={(skills) => set({ skills })}
          />

          <TagEditor
            id="onb-exclude"
            label="Never show me"
            hint="Any posting containing one of these drops off the main board. Useful for wrong-industry collisions and levels you cannot apply to."
            values={profile.exclude}
            placeholder="e.g. Solutions Architect"
            onChange={(exclude) => set({ exclude })}
          />

          <SeniorityPicker
            value={profile.seniority}
            onChange={(seniority: SeniorityPref) => set({ seniority })}
          />

          <TagEditor
            id="onb-locations"
            label="Locations"
            hint='Leave empty for anywhere. "remote" also matches "anywhere" and "distributed".'
            values={profile.locations}
            placeholder="e.g. Austin, or remote"
            onChange={(locations) => set({ locations })}
          />

          <WorkModePicker
            value={profile.workModes}
            onChange={(workModes: WorkMode[]) => set({ workModes })}
          />

          <div className="wizard__nav">
            <button className="btn btn--primary" onClick={() => setStep(3)}>
              Continue
            </button>
            <button className="btn btn--ghost" onClick={() => setStep(1)}>
              Back
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="panel">
          <p className="stepnum">Step 4 of 4</p>
          <h2 className="panel__title">Which companies should it watch?</h2>
          <p className="panel__sub">
            Jobwatch ships with {sources.length} companies whose job boards it can read
            directly. Pick the groups worth checking. After this you can add any other
            company by pasting its careers link, and turn individual companies on and off.
          </p>
          <div className="packgrid">
            {PACKS.map((p) => (
              <button
                key={p.id}
                className="packcard"
                aria-pressed={packs.includes(p.id)}
                onClick={() =>
                  setPacks((prev) =>
                    prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                  )
                }
              >
                <span className="packcard__label">{p.label}</span>
                <span className="packcard__blurb">{p.blurb}</span>
                <span className="packcard__count">{countsByPack[p.id] ?? 0} companies</span>
              </button>
            ))}
          </div>

          {/* Offered here rather than only in Settings, because the shipped catalog will
              never cover every field. Someone whose industry is thin needs to find that out
              and fix it now, not after a first scan that came back nearly empty. */}
          <hr
            style={{
              border: 0,
              borderTop: "var(--border-hair) solid var(--c-border)",
              margin: "var(--space-5) 0",
            }}
          />
          <AddCompany sources={custom} onAdd={(added) => setCustom((prev) => [...prev, ...added])} />
          {custom.length > 0 ? (
            <p className="field__hint">
              Added {custom.length}: {custom.map((s) => s.name).join(", ")}.
            </p>
          ) : null}

          <div className="wizard__nav">
            <button
              className="btn btn--primary"
              disabled={totalCompanies === 0}
              onClick={() => onDone(profile, packs, custom)}
            >
              Scan {totalCompanies} {totalCompanies === 1 ? "company" : "companies"}
            </button>
            <button className="btn btn--ghost" onClick={() => setStep(2)}>
              Back
            </button>
            <span className="field__hint">
              {totalCompanies === 0
                ? "Pick a group, or add an employer by name."
                : `About ${Math.max(5, Math.round(totalCompanies * 0.7))} seconds.`}
            </span>
          </div>
        </section>
      ) : null}
    </div>
  );
}
