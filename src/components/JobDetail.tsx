/**
 * The role detail view.
 *
 * Two jobs here. First, show the posting. Second, and more importantly, show *why it
 * ranked where it did*: the "Why this matched" block lists every keyword that scored,
 * where it was found, and what it was worth. That block is the product's whole argument
 * against opaque relevance, so it sits above the description, not below it.
 */

import { useEffect, useState } from "react";
import type { ScoredJob, Source } from "../lib/types";
import { ageDays, freshness } from "../lib/scoring";
import { fetchDetailHtml, ATS_LABEL } from "../lib/ats";
import { FreshnessChip, MatchChip, Modal } from "./ui";

export function JobDetail({
  job,
  source,
  saved,
  applied,
  onToggleSaved,
  onToggleApplied,
  onClose,
}: {
  job: ScoredJob;
  source: Source | undefined;
  saved: boolean;
  applied: boolean;
  onToggleSaved: () => void;
  onToggleApplied: () => void;
  onClose: () => void;
}) {
  const [html, setHtml] = useState(job.descHtml);
  const [loadingDesc, setLoadingDesc] = useState(false);

  // SmartRecruiters omits the body from its list feed, so it is pulled on open rather than
  // fetched for hundreds of roles nobody clicked.
  useEffect(() => {
    setHtml(job.descHtml);
    if (job.descHtml || !source) return;
    const ctl = new AbortController();
    setLoadingDesc(true);
    fetchDetailHtml(job, source, ctl.signal)
      .then((h) => setHtml(h))
      .catch(() => setHtml(""))
      .finally(() => setLoadingDesc(false));
    return () => ctl.abort();
  }, [job, source]);

  const days = ageDays(job);
  const titleHits = job.hits.filter((h) => h.where === "title");
  const bodyHits = job.hits.filter((h) => h.where === "body");

  return (
    <Modal
      wide
      title={job.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onToggleSaved} aria-pressed={saved}>
            {saved ? "Saved" : "Save"}
          </button>
          <button className="btn" onClick={onToggleApplied} aria-pressed={applied}>
            {applied ? "Marked applied" : "Mark applied"}
          </button>
          {/* Deliberately not autofocused: focusing the footer link scrolls the body past
              "Why this matched", which is the first thing the reader opened this for. */}
          {job.url ? (
            <a className="btn btn--primary" href={job.url} target="_blank" rel="noopener noreferrer">
              Open posting
            </a>
          ) : null}
        </>
      }
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        <MatchChip band={job.band} score={job.score} />
        <FreshnessChip level={freshness(job)} days={days} />
        {job.isNew ? <span className="chip chip--new">New</span> : null}
        {job.seniority === "senior" ? <span className="chip chip--plain">Reads senior</span> : null}
        {job.seniority === "entry" ? <span className="chip chip--plain">Entry friendly</span> : null}
        {job.vetoedBy ? (
          <span className="chip chip--plain" title="One of your excluded keywords appears in this posting">
            Excluded: {job.vetoedBy}
          </span>
        ) : null}
      </div>

      <dl className="detail__facts">
        <dt>Company</dt>
        <dd>{job.company}</dd>
        <dt>Location</dt>
        <dd>{job.location || "Not stated"}</dd>
        {job.department ? (
          <>
            <dt>Team</dt>
            <dd>{job.department}</dd>
          </>
        ) : null}
        <dt>Posted</dt>
        <dd>
          {job.postedAt
            ? `${job.postedAt}${days !== null ? ` (${days === 0 ? "today" : `${days} days ago`})` : ""}`
            : "This board does not publish a date"}
        </dd>
        <dt>Source</dt>
        <dd>{source ? ATS_LABEL[source.kind] : "Unknown board"}</dd>
      </dl>

      <div className="why">
        <div className="why__head">Why this matched</div>
        {job.hits.length === 0 ? (
          <p className="why__empty">
            No keywords matched. This role is on the board because it came from a company you
            follow, not because it fit your keywords.
          </p>
        ) : (
          <>
            {titleHits.length > 0 ? (
              <div style={{ marginBottom: 8 }}>
                <div className="why__empty" style={{ marginBottom: 4 }}>
                  In the title, worth the most:
                </div>
                <div className="why__list">
                  {titleHits.map((h) => (
                    <span key={`t-${h.keyword}`} className="chip chip--good">
                      {h.keyword} +{h.points}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {bodyHits.length > 0 ? (
              <div>
                <div className="why__empty" style={{ marginBottom: 4 }}>
                  In the description:
                </div>
                <div className="why__list">
                  {bodyHits.map((h) => (
                    <span key={`b-${h.keyword}`} className="chip chip--stretch">
                      {h.keyword} +{h.points}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {loadingDesc ? (
        <p className="why__empty">Loading the description from the board...</p>
      ) : html ? (
        // Safe by construction: `html` is the output of sanitizeHtml, which rebuilds the
        // fragment from an allowlist and keeps no attribute except a validated href.
        <div className="desc" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="why__empty">
          This board does not include the description in its feed. Open the posting to read it.
        </p>
      )}
    </Modal>
  );
}
