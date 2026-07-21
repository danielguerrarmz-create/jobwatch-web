/**
 * Adding an employer, by name or by link.
 *
 * Two ways in, because two different people need this. Someone who already has the careers
 * page open pastes the link. Someone who just knows they want to work at their local hospital
 * types the name and lets the app go looking. The second path is the one that makes this tool
 * usable outside tech, so it is the default tab.
 *
 * Nothing is ever added automatically. A slug that answers is not proof of identity, so the
 * user always confirms against the company name and sample roles the board itself returned.
 */

import { useRef, useState } from "react";
import { ATS_LABEL, detectSource } from "../lib/ats";
import { discoverCompany } from "../lib/discover";
import type { Candidate } from "../lib/discover";
import type { Source } from "../lib/types";

type Mode = "name" | "link";

export function AddCompany({
  sources,
  onAdd,
}: {
  sources: Source[];
  /** Receives only genuinely new sources, already deduped against what is followed. */
  onAdd: (added: Source[]) => void;
}) {
  const [mode, setMode] = useState<Mode>("name");
  const [query, setQuery] = useState("");
  const [links, setLinks] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const known = new Set(sources.map((s) => s.id));

  const search = async () => {
    const term = query.trim();
    if (!term) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;

    setSearching(true);
    setNote(null);
    setCandidates(null);
    try {
      const found = await discoverCompany(term, ctl.signal);
      if (ctl.signal.aborted) return;
      setCandidates(found);
      if (found.length === 0) {
        setNote({
          kind: "warn",
          text: `No job board found for "${term}". Either they use a system Jobwatch cannot read (Workday, Taleo, iCIMS, or a custom careers page), or their board is under a different name. If you can find their careers page, try the "Paste a link" tab instead.`,
        });
      }
    } finally {
      if (abortRef.current === ctl) {
        abortRef.current = null;
        setSearching(false);
      }
    }
  };

  const addCandidate = (c: Candidate) => {
    const id = `${c.kind}:${c.token}`;
    if (known.has(id)) {
      setNote({ kind: "warn", text: `You already follow ${c.name}.` });
      return;
    }
    onAdd([{ id, kind: c.kind, token: c.token, name: c.name, pack: "custom", enabled: true }]);
    setNote({ kind: "ok", text: `Added ${c.name}. It will be included in your next scan.` });
    setCandidates((prev) => (prev ? prev.filter((x) => `${x.kind}:${x.token}` !== id) : prev));
  };

  /** Accepts a whole pasted block, one link per line. */
  const addLinks = () => {
    const lines = links.split(/[\n,\s]+/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;

    const seen = new Set(known);
    const added: Source[] = [];
    const rejected: string[] = [];
    let duplicates = 0;

    for (const line of lines) {
      const detected = detectSource(line);
      if (!detected) {
        rejected.push(line);
        continue;
      }
      const id = `${detected.kind}:${detected.token}`;
      if (seen.has(id)) {
        duplicates += 1;
        continue;
      }
      seen.add(id);
      added.push({
        id,
        kind: detected.kind,
        token: detected.token,
        name: detected.token,
        pack: "custom",
        enabled: true,
      });
    }

    if (added.length) {
      onAdd(added);
      setLinks("");
    }

    const parts: string[] = [];
    if (added.length) parts.push(`Added ${added.length}.`);
    if (duplicates) parts.push(`${duplicates} already followed.`);
    if (rejected.length) {
      parts.push(
        `Could not read ${rejected.length}: ${rejected.slice(0, 2).join(", ")}. Jobwatch reads Greenhouse, Lever, Ashby, SmartRecruiters, Workable, and Recruitee links.`,
      );
    }
    setNote({ kind: rejected.length && !added.length ? "warn" : "ok", text: parts.join(" ") });
  };

  return (
    <div className="field tagfield">
      <span className="field__label">Add an employer</span>
      <p className="field__hint">
        Jobwatch is not limited to the companies it ships with. Add anyone whose job board it
        can read, in any industry.
      </p>

      <div className="segmented" role="group" aria-label="How to add a company">
        <button aria-pressed={mode === "name"} onClick={() => setMode("name")}>
          Search by name
        </button>
        <button aria-pressed={mode === "link"} onClick={() => setMode("link")}>
          Paste a link
        </button>
      </div>

      {mode === "name" ? (
        <>
          <p className="field__hint">
            Type a company or organization and Jobwatch will look for their job board across
            all six systems it can read. Check the result before adding it: different companies
            sometimes share a name.
          </p>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <label className="visually-hidden" htmlFor="discover">
              Company name
            </label>
            <input
              id="discover"
              className="input"
              value={query}
              placeholder="e.g. Mount Sinai, Patagonia, Duolingo"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void search();
              }}
            />
            {searching ? (
              <button className="btn" onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            ) : (
              <button className="btn" onClick={() => void search()} disabled={!query.trim()}>
                Search
              </button>
            )}
          </div>

          {searching ? (
            <p className="field__hint" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="spinner" aria-hidden="true" />
              Checking the job boards for a match...
            </p>
          ) : null}

          {candidates && candidates.length > 0 ? (
            <div className="sourcelist" style={{ marginTop: "var(--space-2)" }}>
              {candidates.map((c) => (
                <div className="sourcerow" key={`${c.kind}:${c.token}`}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-med)" }}>
                      {c.name}
                    </div>
                    <div className="sourcerow__kind">
                      {ATS_LABEL[c.kind]} &middot; {c.jobCount}{" "}
                      {c.jobCount === 1 ? "open role" : "open roles"} &middot; {c.sampleTitles.join(", ")}
                    </div>
                  </div>
                  <button className="btn btn--sm" onClick={() => addCandidate(c)}>
                    Add
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="field__hint">
            Paste the link to a company's job board, or several at once, one per line. Works
            with Greenhouse, Lever, Ashby, SmartRecruiters, Workable, and Recruitee. To find it,
            open a company's careers page and click through to any job: the address usually
            shows which system they use.
          </p>
          <textarea
            className="textarea"
            style={{ minHeight: 76 }}
            value={links}
            placeholder={"https://boards.greenhouse.io/company\nhttps://jobs.lever.co/another"}
            onChange={(e) => {
              setLinks(e.target.value);
              setNote(null);
            }}
          />
          <div>
            <button className="btn" onClick={addLinks} disabled={!links.trim()}>
              Add
            </button>
          </div>
        </>
      )}

      {note ? (
        <p
          className="field__hint"
          style={{ color: note.kind === "warn" ? "var(--c-warn)" : "var(--c-text-muted)" }}
          role="status"
        >
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
