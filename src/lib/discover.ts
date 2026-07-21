/**
 * Finding a company's job board by name.
 *
 * The shipped catalog will never cover everyone's field. Someone job-hunting in nursing,
 * logistics, or municipal government needs to add their own employers, and telling them to
 * "paste the careers URL" assumes they know that a company's careers page is secretly
 * Greenhouse and can find the underlying board address. Most people cannot, and should not
 * have to.
 *
 * So: type a company name, and we guess. Slugs are highly predictable ("Peak Design" ->
 * `peakdesign`), so trying a handful of variants against each board finds the real one
 * surprisingly often. Every probe is the same public, unauthenticated request the app
 * already makes, aimed at the same allowlisted hosts, so this adds no new network surface.
 *
 * Results are always presented as candidates for the user to confirm, never auto-added.
 * A slug that happens to answer is not proof of identity: `icon`, `method`, and `mosaic` all
 * return live postings for companies other than the ones you would assume.
 */

import { fetchSource, isValidToken } from "./ats";
import type { AtsKind, Job, Source } from "./types";

export interface Candidate {
  kind: AtsKind;
  token: string;
  /** Name as published by the board, which is the useful confirmation signal. */
  name: string;
  jobCount: number;
  /** A few real titles, so the user can tell at a glance whether this is the right company. */
  sampleTitles: string[];
}

/**
 * Slug variants worth trying, most likely first.
 *
 * "Peak Design" -> `peakdesign`, `peak-design`, `peakdesigninc`. Kept small on purpose:
 * every variant multiplies the request count, and past three or four the hit rate collapses
 * while the politeness cost keeps rising.
 */
export function slugVariants(input: string): string[] {
  const cleaned = input
    .trim()
    .toLowerCase()
    // Drop trailing corporate suffixes before slugging; boards almost never include them.
    .replace(/[,.]?\s+(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|sa|bv|ag)\.?$/g, "")
    .replace(/&/g, "and");

  const alnum = cleaned.replace(/[^a-z0-9]/g, "");
  const hyphen = cleaned.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const firstWord = alnum ? cleaned.split(/[^a-z0-9]+/).filter(Boolean)[0] ?? "" : "";

  const out: string[] = [];
  for (const v of [alnum, hyphen, `${alnum}inc`, firstWord]) {
    if (v && v.length >= 2 && isValidToken(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Which boards to try, in order.
 *
 * Greenhouse, Lever, and Ashby cover the overwhelming majority of what is reachable, so they
 * go first and the rest only run if nothing has been found. Workable and Recruitee matter
 * disproportionately for European and smaller employers, which is exactly the long tail this
 * feature exists for, so they are not dropped, just deferred.
 */
const PRIMARY: AtsKind[] = ["greenhouse", "lever", "ashby"];
const SECONDARY: AtsKind[] = ["smartrecruiters", "workable", "recruitee"];

function probeSource(kind: AtsKind, token: string): Source {
  return { id: `${kind}:${token}`, kind, token, name: token, pack: "custom", enabled: false };
}

async function probe(kind: AtsKind, token: string, signal?: AbortSignal): Promise<Candidate | null> {
  let jobs: Job[];
  try {
    // First page only: a probe answers "does this board exist and whose is it", so paging
    // through every posting would multiply the request count for no extra signal.
    jobs = await fetchSource(probeSource(kind, token), signal, true);
  } catch {
    return null; // A miss is the normal case here, not an error worth surfacing.
  }
  if (jobs.length === 0) return null;
  // Greenhouse and SmartRecruiters publish the company's real name on each posting, which is
  // the best confirmation signal there is. Ashby and Lever do not, and there the adapter has
  // already fallen back to the slug, so tidy it into something presentable.
  const published = jobs[0].company;
  return {
    kind,
    token,
    name: published && published !== token ? published : prettifyToken(token),
    jobCount: jobs.length,
    sampleTitles: jobs.slice(0, 3).map((j) => j.title),
  };
}

/** `peak-design` -> `Peak Design`. Only a display nicety; the token is what we actually use. */
function prettifyToken(token: string): string {
  return token
    .replace(/[-_.]+/g, " ")
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Cap on concurrent probes. Same reasoning as the scan: be a polite guest. */
const PROBE_CONCURRENCY = 4;

async function runBatch(
  pairs: { kind: AtsKind; token: string }[],
  signal: AbortSignal | undefined,
  onFound: (c: Candidate) => void,
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, pairs.length) }, async () => {
      while (cursor < pairs.length) {
        if (signal?.aborted) return;
        const pair = pairs[cursor++];
        const found = await probe(pair.kind, pair.token, signal);
        if (found) onFound(found);
      }
    }),
  );
}

/**
 * Search every board for a company by name.
 *
 * Returns candidates ranked by how many roles they carry, which is a decent proxy for "this
 * is the real company rather than a two-person startup that took the slug first".
 */
export async function discoverCompany(
  name: string,
  signal?: AbortSignal,
): Promise<Candidate[]> {
  const tokens = slugVariants(name);
  if (tokens.length === 0) return [];

  const found = new Map<string, Candidate>();
  const collect = (c: Candidate) => found.set(`${c.kind}:${c.token}`, c);

  const pairs = (kinds: AtsKind[]) =>
    kinds.flatMap((kind) => tokens.map((token) => ({ kind, token })));

  await runBatch(pairs(PRIMARY), signal, collect);
  // Only pay for the slower boards when the common ones came up empty.
  if (found.size === 0 && !signal?.aborted) {
    await runBatch(pairs(SECONDARY), signal, collect);
  }

  return [...found.values()].sort((a, b) => b.jobCount - a.jobCount);
}
