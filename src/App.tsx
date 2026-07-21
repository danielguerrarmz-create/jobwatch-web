/**
 * Application shell: owns all state, runs scans, and renders one of three screens
 * (onboarding, the board, or the board plus a modal).
 *
 * State is kept flat and in one place on purpose. There are about eight things this app
 * remembers and every one of them is either persisted to localStorage or derived from a
 * scan, so a store abstraction would be more machinery than the problem has.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board, DEFAULT_FILTERS, applyFilters } from "./components/Board";
import type { BoardFilters } from "./components/Board";
import { JobDetail } from "./components/JobDetail";
import { Onboarding } from "./components/Onboarding";
import { Settings } from "./components/Settings";
import { Mark } from "./components/ui";
import { catalogSources } from "./lib/catalog";
import { EMPTY_PROFILE } from "./lib/presets";
import { runScan } from "./lib/runner";
import type { RunProgress } from "./lib/runner";
import * as store from "./lib/storage";
import type { Profile, ScoredJob, Source, SourceResult } from "./lib/types";

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(mins)) return "never";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function App() {
  const [meta, setMeta] = useState(() => store.loadMeta());
  const [profile, setProfile] = useState<Profile>(() => store.loadProfile(EMPTY_PROFILE));
  const [sources, setSources] = useState<Source[]>(() => store.loadSources() ?? catalogSources());
  const [seen, setSeen] = useState(() => store.loadSeen());

  const [saved, setSaved] = useState(() => store.loadSaved());
  const [hidden, setHidden] = useState(() => store.loadHidden());
  const [applied, setApplied] = useState(() => store.loadApplied());

  const [jobs, setJobs] = useState<ScoredJob[]>([]);
  const [results, setResults] = useState<SourceResult[]>([]);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [newCount, setNewCount] = useState(0);

  const [filters, setFilters] = useState<BoardFilters>(DEFAULT_FILTERS);
  const [openJob, setOpenJob] = useState<ScoredJob | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const running = progress !== null;

  /* ------------------------------------------------------------- persistence */

  useEffect(() => { store.saveProfile(profile); }, [profile]);
  useEffect(() => { store.saveSources(sources); }, [sources]);
  useEffect(() => { store.saveMeta(meta); }, [meta]);
  useEffect(() => { store.persistSaved(saved); }, [saved]);
  useEffect(() => { store.persistHidden(hidden); }, [hidden]);
  useEffect(() => { store.persistApplied(applied); }, [applied]);

  /* -------------------------------------------------------------------- theme */

  // The *effective* theme, which is not the same as the stored preference: "system" resolves
  // against the OS. Tracking it in state matters because the toggle has to flip what the user
  // is actually looking at. Flipping the preference instead means the first click on a
  // dark-by-system machine sets the preference to "dark" and visibly does nothing.
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(
    () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = meta.theme === "dark" || (meta.theme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      setResolvedTheme(dark ? "dark" : "light");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [meta.theme]);

  /* ---------------------------------------------------------------- the scan */

  const scan = useCallback(
    async (withSources: Source[], withProfile: Profile) => {
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;

      setProgress({ done: 0, total: withSources.filter((s) => s.enabled).length, active: [], results: [] });
      try {
        const outcome = await runScan(withSources, withProfile, seen, setProgress, ctl.signal);
        if (ctl.signal.aborted) return;
        setJobs(outcome.jobs);
        setResults(outcome.results);
        setNewCount(outcome.newCount);
        setSeen(outcome.seen);
        store.saveSeen(outcome.seen);
        setMeta((m) => ({ ...m, lastRun: outcome.ranAt, onboarded: true }));
      } finally {
        if (abortRef.current === ctl) {
          abortRef.current = null;
          setProgress(null);
        }
      }
    },
    [seen],
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * Scan once when a returning user opens the app.
   *
   * Results are not persisted between visits (a few thousand postings with descriptions
   * would not fit in localStorage, and stale results are worse than none for a tool whose
   * whole job is telling you what changed). So without this, opening Jobwatch shows an
   * empty board and a button, which is a poor greeting for a product named "watch".
   *
   * The ref guard is load-bearing: StrictMode mounts twice in development, and without it
   * every dev reload would fire two full scans at other people's servers.
   */
  const autoScanned = useRef(false);
  useEffect(() => {
    if (autoScanned.current || !meta.onboarded) return;
    if (!sources.some((s) => s.enabled)) return;
    autoScanned.current = true;
    void scan(sources, profile);
    // Deliberately mount-only. Re-running on every sources/profile edit would scan on
    // each keystroke in Settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishOnboarding = (chosenProfile: Profile, packs: string[]) => {
    const chosen = new Set(packs);
    const next = sources.map((s) => ({ ...s, enabled: chosen.has(s.pack) }));
    setProfile(chosenProfile);
    setSources(next);
    setMeta((m) => ({ ...m, onboarded: true }));
    void scan(next, chosenProfile);
  };

  /* ------------------------------------------------------------------ derived */

  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const visibleJobs = useMemo(
    () => applyFilters(jobs, filters, saved, hidden, applied, profile.minScore),
    [jobs, filters, saved, hidden, applied, profile.minScore],
  );
  const failed = results.filter((r) => r.status === "error");
  const enabledCount = sources.filter((s) => s.enabled).length;

  const toggleIn = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  if (!meta.onboarded) {
    return (
      <div className="app">
        <div className="layout">
          <Onboarding sources={sources} onDone={finishOnboarding} />
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Mark className="brand__mark" />
          <span className="brand__name">Jobwatch</span>
          <span className="brand__tag">straight from the source</span>
        </div>

        <div className="topbar__spacer" />

        <span className="topbar__meta">
          {running ? "Scanning" : `Last scan ${relativeTime(meta.lastRun)}`}
        </span>

        <button
          className="btn btn--ghost"
          onClick={() => setMeta((m) => ({ ...m, theme: resolvedTheme === "dark" ? "light" : "dark" }))}
          aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
        >
          {resolvedTheme === "dark" ? "☀" : "☾"}
        </button>
        <button className="btn" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
        {running ? (
          <button className="btn" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button
            className="btn btn--primary"
            onClick={() => void scan(sources, profile)}
            disabled={enabledCount === 0}
          >
            Scan now
          </button>
        )}
      </header>

      <main className="layout">
        {running && progress ? (
          <div className="runbar">
            <div className="runbar__head">
              <span className="spinner" aria-hidden="true" />
              <span>Reading boards</span>
              <span className="runbar__count">
                {progress.done} of {progress.total}
              </span>
            </div>
            <div className="progress">
              <div
                className="progress__fill"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
            <div className="runbar__active">
              {progress.active.length ? progress.active.join(", ") : "finishing up"}
            </div>
          </div>
        ) : null}

        {!running && jobs.length === 0 ? (
          <div className="empty">
            <div className="empty__title">
              {enabledCount === 0 ? "No companies followed yet" : "No results yet"}
            </div>
            <p className="empty__body">
              {enabledCount === 0
                ? "Open Settings and follow a few companies, or paste a careers link to add one that is not in the list."
                : `Jobwatch is following ${enabledCount} companies. Run a scan to read their boards.`}
            </p>
            <button
              className="btn btn--primary"
              onClick={() => (enabledCount === 0 ? setSettingsOpen(true) : void scan(sources, profile))}
            >
              {enabledCount === 0 ? "Open settings" : "Scan now"}
            </button>
          </div>
        ) : null}

        {jobs.length > 0 ? (
          <>
            {newCount > 0 ? (
              <div className="notice">
                <strong>{newCount} new</strong>
                <span>
                  since your last scan.{" "}
                  <button
                    className="btn btn--sm btn--ghost"
                    onClick={() => setFilters({ ...filters, view: "new" })}
                  >
                    Show only new
                  </button>
                </span>
              </div>
            ) : null}

            {failed.length > 0 ? (
              <details className="notice notice--warn">
                <summary>
                  {failed.length} {failed.length === 1 ? "source" : "sources"} could not be read
                </summary>
                <ul className="errorlist" style={{ marginTop: "var(--space-2)" }}>
                  {failed.map((r) => (
                    <li key={r.source.id}>
                      {r.source.name} <code>{r.error}</code>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            <Board
              jobs={visibleJobs}
              total={jobs.length}
              filters={filters}
              onFilters={setFilters}
              saved={saved}
              hidden={hidden}
              applied={applied}
              onOpen={setOpenJob}
              onToggleSaved={(id) => setSaved((s) => toggleIn(s, id))}
              onToggleHidden={(id) => setHidden((s) => toggleIn(s, id))}
            />
          </>
        ) : null}
      </main>

      {openJob ? (
        <JobDetail
          job={openJob}
          source={sourceById.get(openJob.sourceId)}
          saved={saved.has(openJob.id)}
          applied={applied.has(openJob.id)}
          onToggleSaved={() => setSaved((s) => toggleIn(s, openJob.id))}
          onToggleApplied={() => setApplied((s) => toggleIn(s, openJob.id))}
          onClose={() => setOpenJob(null)}
        />
      ) : null}

      {settingsOpen ? (
        <Settings
          profile={profile}
          sources={sources}
          onProfile={setProfile}
          onSources={setSources}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}
