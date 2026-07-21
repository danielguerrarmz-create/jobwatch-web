/**
 * The board: filter toolbar plus the ranked list.
 *
 * Filtering happens here rather than in the runner so that changing a filter is instant and
 * never costs a refetch. The full result set stays in memory; the toolbar only decides what
 * you are looking at.
 */

import { useMemo } from "react";
import type { ScoredJob } from "../lib/types";
import { ageDays, freshness } from "../lib/scoring";
import { FreshnessChip, MatchChip } from "./ui";

export type BandFilter = "all" | "partial" | "good" | "strong";
export type ViewFilter = "open" | "new" | "saved" | "applied" | "hidden";
export type SortKey = "match" | "newest";

export interface BoardFilters {
  query: string;
  band: BandFilter;
  view: ViewFilter;
  sort: SortKey;
  hideStale: boolean;
  hideSenior: boolean;
}

export const DEFAULT_FILTERS: BoardFilters = {
  query: "",
  band: "all",
  view: "open",
  sort: "match",
  hideStale: false,
  hideSenior: false,
};

const BAND_RANK = { stretch: 0, partial: 1, good: 2, strong: 3 } as const;
const BAND_MIN: Record<BandFilter, number> = { all: -1, partial: 1, good: 2, strong: 3 };

export function applyFilters(
  jobs: ScoredJob[],
  f: BoardFilters,
  saved: Set<string>,
  hidden: Set<string>,
  applied: Set<string>,
  minScore: number,
): ScoredJob[] {
  const q = f.query.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];

  const out = jobs.filter((job) => {
    // The view decides the base population; every other control narrows within it.
    switch (f.view) {
      case "saved":
        if (!saved.has(job.id)) return false;
        break;
      case "applied":
        if (!applied.has(job.id)) return false;
        break;
      case "hidden":
        if (!hidden.has(job.id)) return false;
        break;
      case "new":
        if (!job.isNew || hidden.has(job.id)) return false;
        break;
      default:
        if (hidden.has(job.id)) return false;
        // Vetoed and below-threshold roles are kept in memory but off the default board,
        // so a too-aggressive keyword list can always be walked back without a refetch.
        if (job.vetoedBy) return false;
        if (job.score < minScore) return false;
    }

    if (BAND_RANK[job.band] < BAND_MIN[f.band]) return false;
    if (f.hideStale && freshness(job) === "stale") return false;
    if (f.hideSenior && job.seniority === "senior") return false;

    if (terms.length) {
      const hay = `${job.title} ${job.company} ${job.location} ${job.department ?? ""}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  const byDate = (a: ScoredJob, b: ScoredJob) => (b.postedAt ?? "").localeCompare(a.postedAt ?? "");
  // Staleness outranks score in the default order. A perfect keyword match posted 300 days
  // ago is not a better lead than a good one posted yesterday; sorting on score alone put
  // long-dead postings at the top of the board, which is exactly the failure mode that
  // makes general job boards useless.
  const staleRank = (j: ScoredJob) => (freshness(j) === "stale" ? 1 : 0);
  out.sort((a, b) =>
    f.sort === "newest"
      ? byDate(a, b) || b.score - a.score
      : Number(b.isNew) - Number(a.isNew) ||
        staleRank(a) - staleRank(b) ||
        b.score - a.score ||
        byDate(a, b),
  );
  return out;
}

function JobRow({
  job,
  saved,
  hidden,
  applied,
  onOpen,
  onToggleSaved,
  onToggleHidden,
}: {
  job: ScoredJob;
  saved: boolean;
  hidden: boolean;
  applied: boolean;
  onOpen: () => void;
  onToggleSaved: () => void;
  onToggleHidden: () => void;
}) {
  return (
    <div className={applied || hidden ? "jobcard jobcard--dim" : "jobcard"}>
      <button
        className="jobcard__main"
        onClick={onOpen}
        style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left" }}
      >
        <div className="jobcard__title">{job.title}</div>
        <div className="jobcard__meta">
          <span className="jobcard__company">{job.company}</span>
          {job.location ? (
            <>
              <span className="jobcard__sep">/</span>
              <span>{job.location}</span>
            </>
          ) : null}
          {job.department ? (
            <>
              <span className="jobcard__sep">/</span>
              <span>{job.department}</span>
            </>
          ) : null}
        </div>
      </button>

      <div>
        <div className="jobcard__chips">
          {job.isNew ? <span className="chip chip--new">New</span> : null}
          {applied ? <span className="chip chip--plain">Applied</span> : null}
          <MatchChip band={job.band} score={job.score} />
          <FreshnessChip level={freshness(job)} days={ageDays(job)} />
        </div>
        <div className="jobcard__actions">
          <button
            className="iconbtn"
            onClick={onToggleSaved}
            aria-pressed={saved}
            aria-label={saved ? `Unsave ${job.title}` : `Save ${job.title}`}
            title={saved ? "Saved" : "Save"}
          >
            {saved ? "★" : "☆"}
          </button>
          <button
            className="iconbtn"
            onClick={onToggleHidden}
            aria-pressed={hidden}
            aria-label={hidden ? `Unhide ${job.title}` : `Hide ${job.title}`}
            title={hidden ? "Hidden, click to restore" : "Hide"}
          >
            {hidden ? "↺" : "✕"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Board({
  jobs,
  total,
  filters,
  onFilters,
  saved,
  hidden,
  applied,
  onOpen,
  onToggleSaved,
  onToggleHidden,
}: {
  jobs: ScoredJob[];
  total: number;
  filters: BoardFilters;
  onFilters: (f: BoardFilters) => void;
  saved: Set<string>;
  hidden: Set<string>;
  applied: Set<string>;
  onOpen: (job: ScoredJob) => void;
  onToggleSaved: (id: string) => void;
  onToggleHidden: (id: string) => void;
}) {
  const set = (patch: Partial<BoardFilters>) => onFilters({ ...filters, ...patch });
  const companies = useMemo(() => new Set(jobs.map((j) => j.company)).size, [jobs]);

  return (
    <>
      <div className="toolbar">
        <div className="toolbar__search">
          <label className="visually-hidden" htmlFor="board-search">
            Search these results
          </label>
          <input
            id="board-search"
            className="input"
            type="search"
            placeholder="Filter by title, company, or location"
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
          />
        </div>

        <div className="segmented" role="group" aria-label="Which roles to show">
          {(
            [
              ["open", "Open"],
              ["new", "New"],
              ["saved", "Saved"],
              ["applied", "Applied"],
              ["hidden", "Hidden"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filters.view === value}
              onClick={() => set({ view: value })}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="visually-hidden" htmlFor="board-band">
          Minimum match
        </label>
        <select
          id="board-band"
          className="select"
          value={filters.band}
          onChange={(e) => set({ band: e.target.value as BandFilter })}
        >
          <option value="all">Any match</option>
          <option value="partial">Partial and up</option>
          <option value="good">Good and up</option>
          <option value="strong">Strong only</option>
        </select>

        <label className="visually-hidden" htmlFor="board-sort">
          Sort order
        </label>
        <select
          id="board-sort"
          className="select"
          value={filters.sort}
          onChange={(e) => set({ sort: e.target.value as SortKey })}
        >
          <option value="match">Best match first</option>
          <option value="newest">Newest first</option>
        </select>

        <label className="checkline">
          <input
            type="checkbox"
            checked={filters.hideStale}
            onChange={(e) => set({ hideStale: e.target.checked })}
          />
          <span style={{ fontSize: "var(--text-sm)" }}>Hide stale</span>
        </label>
        <label className="checkline">
          <input
            type="checkbox"
            checked={filters.hideSenior}
            onChange={(e) => set({ hideSenior: e.target.checked })}
          />
          <span style={{ fontSize: "var(--text-sm)" }}>Hide senior</span>
        </label>
      </div>

      <div className="resultline">
        <span>
          <strong>{jobs.length}</strong> {jobs.length === 1 ? "role" : "roles"} at{" "}
          <strong>{companies}</strong> {companies === 1 ? "company" : "companies"}
        </span>
        {total > jobs.length ? <span>{total - jobs.length} filtered out</span> : null}
      </div>

      {jobs.length === 0 ? (
        <div className="empty">
          <div className="empty__title">Nothing here right now</div>
          <p className="empty__body">
            Either the filters are too tight or the companies you follow have no matching
            openings. Try setting the match filter to Any, or add more companies in Settings.
          </p>
        </div>
      ) : (
        <div className="joblist">
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              saved={saved.has(job.id)}
              hidden={hidden.has(job.id)}
              applied={applied.has(job.id)}
              onOpen={() => onOpen(job)}
              onToggleSaved={() => onToggleSaved(job.id)}
              onToggleHidden={() => onToggleHidden(job.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}
