/**
 * The run: poll every enabled source, dedupe, score, and mark what is new.
 *
 * Concurrency is deliberately modest. These are other people's public endpoints and we are
 * a guest on them; six in flight keeps a 60-company run under a minute without looking like
 * an attack. One source failing is normal (a company deletes a board, a network hiccups)
 * and must never take down the run, so every fetch is individually caught and reported.
 */

import { fetchSource, FetchError } from "./ats";
import { compileProfile, locationAllowed, scoreJob, workModeAllowed } from "./scoring";
import type { Job, Profile, ScoredJob, Source, SourceResult } from "./types";
import type { SeenMap } from "./storage";

const CONCURRENCY = 6;

/** Ceiling on a single run. Following 200 companies is already a slow run; anything past
 *  this is a board misbehaving, and the board should not get to decide how much memory the
 *  tab uses. */
const MAX_JOBS = 20_000;

export interface RunProgress {
  done: number;
  total: number;
  /** Sources currently in flight, for the "checking X, Y, Z" line. */
  active: string[];
  results: SourceResult[];
}

export interface RunOutcome {
  jobs: ScoredJob[];
  results: SourceResult[];
  seen: SeenMap;
  newCount: number;
  ranAt: string;
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

export async function runScan(
  sources: Source[],
  profile: Profile,
  seenIn: SeenMap,
  onProgress: (p: RunProgress) => void,
  signal?: AbortSignal,
): Promise<RunOutcome> {
  const enabled = sources.filter((s) => s.enabled);
  const results: SourceResult[] = [];
  const collected: Job[] = [];
  const active = new Set<string>();
  let done = 0;

  const emit = () => onProgress({ done, total: enabled.length, active: [...active], results: [...results] });
  emit();

  await runPool(enabled, CONCURRENCY, async (source) => {
    if (signal?.aborted) return;
    active.add(source.name);
    emit();
    const started = performance.now();
    try {
      const jobs = await fetchSource(source, signal);
      // Appended one at a time rather than spread. `push(...jobs)` passes every element as
      // an argument, which a board returning tens of thousands of roles turns into a stack
      // overflow, and the total is capped so one such board cannot own the whole run.
      for (const job of jobs) {
        if (collected.length >= MAX_JOBS) break;
        collected.push(job);
      }
      results.push({
        source,
        status: jobs.length ? "ok" : "empty",
        count: jobs.length,
        ms: Math.round(performance.now() - started),
      });
    } catch (err) {
      results.push({
        source,
        status: "error",
        count: 0,
        error: err instanceof FetchError ? err.message : "unexpected error",
        ms: Math.round(performance.now() - started),
      });
    } finally {
      active.delete(source.name);
      done += 1;
      emit();
    }
  });

  // The same role can appear twice when a company runs two boards during a migration.
  const unique = new Map<string, Job>();
  for (const job of collected) {
    const key = `${job.company.toLowerCase()}|${job.title.toLowerCase()}|${job.location.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, job);
  }

  const compiled = compileProfile(profile);
  const seen: SeenMap = Object.assign(Object.create(null), seenIn);
  const nowIso = new Date().toISOString();
  // A first-ever run would otherwise flag every single posting as new, which is noise, not
  // signal. New only means something once there is a previous run to be new relative to.
  const firstEverRun = Object.keys(seenIn).length === 0;

  const jobs: ScoredJob[] = [];
  let newCount = 0;

  for (const job of unique.values()) {
    const previously = seen[job.id];
    const isNew = !firstEverRun && !previously;
    if (!previously) seen[job.id] = nowIso;
    if (isNew) newCount += 1;
    jobs.push(scoreJob(job, compiled, previously ?? nowIso, isNew));
  }

  // Location and work arrangement are filters rather than score adjustments: a job in the
  // wrong city is not a weaker match, it is not a match at all, and burying it at the
  // bottom of the board would just make the board longer.
  const filtered = jobs.filter(
    (j) => locationAllowed(j.location, compiled.locations) && workModeAllowed(j, compiled.workModes),
  );

  filtered.sort(
    (a, b) =>
      Number(b.isNew) - Number(a.isNew) ||
      b.score - a.score ||
      (b.postedAt ?? "").localeCompare(a.postedAt ?? ""),
  );

  return { jobs: filtered, results, seen, newCount, ranAt: nowIso };
}
