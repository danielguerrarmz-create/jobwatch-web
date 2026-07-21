/**
 * Settings.
 *
 * Four tabs mirroring the four things a person actually wants to change: who I am, what I
 * want, where to look, and my data. Everything the setup wizard asked is here in the same
 * words, so nothing chosen on the way in is stuck.
 *
 * The keyword editors are the important part. Seeing a bad match on the board, opening the
 * role to read which keyword caused it, then deleting that keyword here is the whole loop
 * the transparent matcher exists to enable.
 */

import { useMemo, useState } from "react";
import type { Profile, SeniorityPref, Source, WorkMode } from "../lib/types";
import { PACKS, packLabel } from "../lib/catalog";
import { ATS_LABEL } from "../lib/ats";
import { extractFromResume } from "../lib/extract";
import type { Extraction } from "../lib/extract";
import { Modal } from "./ui";
import { TagEditor } from "./TagEditor";
import { AddCompany } from "./AddCompany";
import { SeniorityPicker, WorkModePicker } from "./ProfileFields";
import { clearAll, clearResume, exportAll, importAll } from "../lib/storage";

type Tab = "you" | "seeking" | "companies" | "data";

export function Settings({
  profile,
  sources,
  onProfile,
  onSources,
  onClose,
}: {
  profile: Profile;
  sources: Source[];
  onProfile: (p: Profile) => void;
  onSources: (s: Source[]) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("you");

  return (
    <Modal wide title="Settings" onClose={onClose}>
      <div className="tabs" role="tablist">
        {(
          [
            ["you", "Your profile"],
            ["seeking", "What you want"],
            ["companies", "Companies"],
            ["data", "Your data"],
          ] as const
        ).map(([value, label]) => (
          <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "you" ? <YouTab profile={profile} onProfile={onProfile} /> : null}
      {tab === "seeking" ? <SeekingTab profile={profile} onProfile={onProfile} /> : null}
      {tab === "companies" ? <CompaniesTab sources={sources} onSources={onSources} /> : null}
      {tab === "data" ? <DataTab profile={profile} onProfile={onProfile} /> : null}
    </Modal>
  );
}

/* ------------------------------------------------------------- your profile */

function YouTab({ profile, onProfile }: { profile: Profile; onProfile: (p: Profile) => void }) {
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const set = (patch: Partial<Profile>) => onProfile({ ...profile, ...patch });

  const parse = () => {
    if (!profile.resume.trim()) return;
    setExtraction(extractFromResume(profile.resume));
  };

  return (
    <div>
      <div className="field tagfield">
        <label className="field__label" htmlFor="headline">
          How would you describe yourself?
        </label>
        <p className="field__hint">
          Only for your own reference when you come back to this. It is not used for matching.
        </p>
        <input
          id="headline"
          className="input"
          value={profile.headline}
          placeholder="e.g. Recent architecture grad moving into design technology"
          onChange={(e) => set({ headline: e.target.value })}
        />
      </div>

      <div className="privacynote">
        <span>
          <strong>Your resume stays on this machine.</strong> It is never sent anywhere,
          because there is no server to send it to. It is kept in this browser's local
          storage, which means anyone with access to this browser profile can read it, and so
          can browser extensions you have installed. Erase it below without losing the rest of
          your setup, or keep it out of storage entirely with the option under it.
        </span>
      </div>

      <label className="checkline" style={{ marginBottom: "var(--space-4)" }}>
        <input
          type="checkbox"
          checked={!profile.rememberResume}
          onChange={(e) => set({ rememberResume: !e.target.checked })}
        />
        <span>
          Do not save my resume on this computer
          <span className="field__hint">
            {" "}
            For a shared, borrowed, or public machine. The text is used for suggestions now
            and is gone when you close the tab. The skills and titles you add from it stay.
          </span>
        </span>
      </label>

      <div className="field tagfield">
        <label className="field__label" htmlFor="resume-edit">
          Resume text
        </label>
        <p className="field__hint">
          Paste an updated resume any time, then re-read it to refresh the suggested titles
          and skills. Suggestions are only ever suggestions: nothing changes until you add it.
        </p>
        <textarea
          id="resume-edit"
          className="textarea resumebox"
          value={profile.resume}
          onChange={(e) => set({ resume: e.target.value })}
          placeholder="Paste the full text of your resume here."
          spellCheck={false}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
          <button className="btn" onClick={parse} disabled={!profile.resume.trim()}>
            Re-read my resume
          </button>
          <button
            className="btn btn--danger"
            disabled={!profile.resume}
            onClick={() => {
              if (confirm("Erase the stored resume text? Your keywords and companies stay.")) {
                onProfile(clearResume(profile));
                setExtraction(null);
              }
            }}
          >
            Erase resume only
          </button>
        </div>
      </div>

      {extraction ? (
        <div className="extractsummary">
          Read your resume. {extraction.seniorityReason} Add anything useful below, the rest
          is ignored.
        </div>
      ) : null}

      <TagEditor
        id="set-skills"
        label="Your skills"
        hint="Tools, languages, and methods you have. A posting mentioning one of these scores as supporting evidence, worth less than a title match."
        values={profile.skills}
        placeholder="e.g. Figma"
        suggestions={extraction?.skills.map((s) => s.value) ?? []}
        onChange={(skills) => set({ skills })}
      />

      <SeniorityPicker value={profile.seniority} onChange={(seniority: SeniorityPref) => set({ seniority })} />
    </div>
  );
}

/* ------------------------------------------------------------ what you want */

function SeekingTab({ profile, onProfile }: { profile: Profile; onProfile: (p: Profile) => void }) {
  const set = (patch: Partial<Profile>) => onProfile({ ...profile, ...patch });

  return (
    <div>
      <p className="field__hint" style={{ marginBottom: "var(--space-5)" }}>
        A keyword found in a job <strong>title</strong> is worth three times the same keyword
        found only in the description. Matching is whole-word, so "designer" will not match
        "redesigner". Changes take effect on your next scan.
      </p>

      <TagEditor
        id="set-titles"
        label="Roles you want"
        hint="Job titles, not skills. This is the strongest signal the matcher has."
        values={profile.targetTitles}
        placeholder="e.g. Product Designer"
        onChange={(targetTitles) => set({ targetTitles })}
      />

      <TagEditor
        id="set-extra"
        label="Other words worth points"
        hint="Industries, domains, teams, or anything else that is neither a title nor a skill. Scored the same as a title keyword."
        values={profile.extraKeywords}
        placeholder="e.g. climate, healthcare, design systems"
        onChange={(extraKeywords) => set({ extraKeywords })}
      />

      <TagEditor
        id="set-exclude"
        label="Never show me"
        hint="Any posting containing one of these drops off the main board. It is not deleted, so you can undo an over-aggressive rule without rescanning."
        values={profile.exclude}
        placeholder="e.g. Solutions Architect"
        onChange={(exclude) => set({ exclude })}
      />

      <TagEditor
        id="set-locations"
        label="Locations"
        hint='Leave empty for anywhere. "remote" also matches "anywhere" and "distributed".'
        values={profile.locations}
        placeholder="e.g. Austin, or remote"
        onChange={(locations) => set({ locations })}
      />

      <WorkModePicker value={profile.workModes} onChange={(workModes: WorkMode[]) => set({ workModes })} />

      <div className="field tagfield">
        <label className="field__label" htmlFor="minscore">
          Minimum score to show: {profile.minScore}
        </label>
        <p className="field__hint">
          3 means one of your target titles appearing in a job title is enough. Lower it to
          see more, raise it to see only obvious fits. Nothing is deleted either way, so this
          is safe to move around.
        </p>
        <input
          id="minscore"
          type="range"
          min={0}
          max={15}
          step={1}
          value={profile.minScore}
          onChange={(e) => set({ minScore: Number(e.target.value) })}
          style={{ accentColor: "var(--c-accent)" }}
        />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- companies */

function CompaniesTab({ sources, onSources }: { sources: Source[]; onSources: (s: Source[]) => void }) {
  const [query, setQuery] = useState("");
  const [packFilter, setPackFilter] = useState("all");

  const enabledCount = sources.filter((s) => s.enabled).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sources
      .filter((s) => (packFilter === "all" ? true : s.pack === packFilter))
      .filter((s) => (q ? s.name.toLowerCase().includes(q) || s.token.includes(q) : true))
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  }, [sources, query, packFilter]);

  const toggle = (id: string) =>
    onSources(sources.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));

  const setAllVisible = (enabled: boolean) => {
    const ids = new Set(visible.map((s) => s.id));
    onSources(sources.map((s) => (ids.has(s.id) ? { ...s, enabled } : s)));
  };

  return (
    <div>
      <AddCompany sources={sources} onAdd={(added) => onSources([...added, ...sources])} />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="visually-hidden" htmlFor="src-search">
            Search companies
          </label>
          <input
            id="src-search"
            className="input"
            type="search"
            value={query}
            placeholder="Search companies"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="visually-hidden" htmlFor="src-pack">
          Filter by industry
        </label>
        <select
          id="src-pack"
          className="select"
          value={packFilter}
          onChange={(e) => setPackFilter(e.target.value)}
        >
          <option value="all">All industries</option>
          {PACKS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Added by you</option>
        </select>
        <button className="btn btn--sm" onClick={() => setAllVisible(true)}>
          Follow all shown
        </button>
        <button className="btn btn--sm" onClick={() => setAllVisible(false)}>
          Unfollow all shown
        </button>
      </div>

      <p className="field__hint" style={{ marginBottom: "var(--space-2)" }}>
        Following <strong>{enabledCount}</strong> of {sources.length}. Each one is a separate
        request when you scan, so following 200 companies makes a slower run, not a better one.
      </p>

      <div className="sourcelist">
        {visible.length === 0 ? (
          <div style={{ padding: "var(--space-4)", color: "var(--c-text-muted)", fontSize: "var(--text-sm)" }}>
            No companies match that search.
          </div>
        ) : (
          visible.map((s) => (
            <div className="sourcerow" key={s.id}>
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={() => toggle(s.id)}
                aria-label={`Follow ${s.name}`}
                style={{ accentColor: "var(--c-accent)" }}
              />
              <span className="sourcerow__name">{s.name}</span>
              <span className="sourcerow__kind">
                {ATS_LABEL[s.kind]} / {packLabel(s.pack)}
              </span>
              {s.pack === "custom" ? (
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => onSources(sources.filter((x) => x.id !== s.id))}
                  aria-label={`Remove ${s.name}`}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- data */

function DataTab({ profile, onProfile }: { profile: Profile; onProfile: (p: Profile) => void }) {
  const [includeResume, setIncludeResume] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const download = () => {
    const blob = new Blob([exportAll(includeResume)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jobwatch-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    // Not revoked immediately: some browsers have not started reading the blob by the time
    // click() returns, and revoking first cancels the download.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const upload = (file: File) => {
    file
      .text()
      .then((text) => {
        if (importAll(text)) {
          setImportMsg("Imported. Reloading...");
          setTimeout(() => location.reload(), 600);
        } else {
          setImportMsg("That file is not a Jobwatch backup.");
        }
      })
      .catch(() => setImportMsg("Could not read that file."));
  };

  return (
    <div>
      <p className="field__hint" style={{ marginBottom: "var(--space-5)" }}>
        Jobwatch has no account and no server. Your profile, your resume, your followed
        companies, your saved roles, and the history that powers the New badge all live in
        this browser only. Clearing your browser data erases them, so export a backup if you
        want to keep them or move to another machine.
      </p>

      <div className="field tagfield">
        <label className="checkline">
          <input
            type="checkbox"
            checked={includeResume}
            onChange={(e) => setIncludeResume(e.target.checked)}
            disabled={!profile.resume}
          />
          <span>
            Include my resume text in the backup
            <span className="field__hint">
              {profile.resume
                ? " Off by default. A backup file gets emailed and synced to cloud drives, and your resume is the one genuinely personal thing in here."
                : " No resume is stored right now."}
            </span>
          </span>
        </label>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginBottom: "var(--space-5)" }}>
        <button className="btn" onClick={download}>
          Export a backup
        </button>
        <label className="btn" style={{ cursor: "pointer" }}>
          Import a backup
          <input
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {importMsg ? <p className="field__hint">{importMsg}</p> : null}

      <div className="panel" style={{ background: "var(--c-surface)" }}>
        <div className="panel__title">Erase your resume</div>
        <p className="panel__sub">
          Removes the stored resume text and nothing else. Useful on a shared or borrowed
          computer. Your keywords, companies, and saved roles all stay.
        </p>
        <button
          className="btn"
          disabled={!profile.resume}
          onClick={() => {
            if (confirm("Erase the stored resume text? Everything else stays.")) {
              onProfile(clearResume(profile));
            }
          }}
        >
          Erase resume only
        </button>
      </div>

      <div className="panel" style={{ background: "var(--c-surface)" }}>
        <div className="panel__title">Start over</div>
        <p className="panel__sub">
          Erases everything Jobwatch has stored in this browser. There is no undo and no copy
          anywhere else.
        </p>
        <button
          className="btn btn--danger"
          onClick={() => {
            if (confirm("Erase all Jobwatch data in this browser? This cannot be undone.")) {
              clearAll();
              location.reload();
            }
          }}
        >
          Erase everything
        </button>
      </div>
    </div>
  );
}
