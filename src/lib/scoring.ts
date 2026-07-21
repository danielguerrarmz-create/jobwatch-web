/**
 * The fit engine.
 *
 * Deliberately a transparent keyword matcher, not a model. Every point a job earns is
 * attributable to a specific keyword in a specific place, which means the UI can always
 * answer "why did this score 11?" with a list you can read and then go edit. A black-box
 * relevance score you cannot interrogate is worse than no score, because you stop
 * trusting the ranking and go back to scrolling.
 *
 * The math:
 *   core keyword in the TITLE   +3      core keyword in the BODY   +1
 *   bonus keyword in the TITLE  +1      bonus keyword in the BODY  +0.5
 *   any exclude keyword anywhere -> vetoed (kept, but hidden by default)
 *
 * A single core keyword in a title therefore clears the default `minScore` of 3, which is
 * the behavior you want: titles are the highest-signal field on any job board.
 */

import type { FitBand, Hit, Job, Profile, ScoredJob, SeniorityPref, WorkMode } from "./types";

/** Keywords are matched on word boundaries so "ai" does not match "said" and "R&D" does
 *  not match "R&Development". `\b` only makes sense next to a word character, so the
 *  boundary is applied conditionally per edge. */
function keywordRegex(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const left = /^\w/.test(keyword) ? "\\b" : "";
  const right = /\w$/.test(keyword) ? "\\b" : "";
  return new RegExp(`${left}${escaped}${right}`, "i");
}

interface CompiledKeyword {
  keyword: string;
  lower: string;
  re: RegExp;
}

function compile(keywords: string[]): CompiledKeyword[] {
  const seen = new Set<string>();
  const out: CompiledKeyword[] = [];
  for (const raw of keywords) {
    const keyword = raw.trim();
    if (!keyword) continue;
    const lower = keyword.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    try {
      out.push({ keyword, lower, re: keywordRegex(keyword) });
    } catch {
      // A keyword that cannot compile is skipped rather than killing the whole run.
    }
  }
  return out;
}

export interface CompiledProfile {
  core: CompiledKeyword[];
  bonus: CompiledKeyword[];
  exclude: CompiledKeyword[];
  locations: string[];
  workModes: WorkMode[];
  minScore: number;
  seniority: SeniorityPref;
}

/**
 * Derive the matcher's weights from the plain-language profile.
 *
 * The two halves of the profile map onto the two weights: the roles you are targeting are
 * the thing being matched (core), and the skills you have are corroboration (bonus). Keeping
 * that mapping here rather than in the UI means the settings screen never has to say the
 * words "core keyword" to a person who just wants a job.
 */
export function compileProfile(profile: Profile): CompiledProfile {
  return {
    core: compile([...profile.targetTitles, ...profile.extraKeywords]),
    bonus: compile(profile.skills),
    exclude: compile(profile.exclude),
    locations: profile.locations.map((l) => l.trim().toLowerCase()).filter(Boolean),
    workModes: profile.workModes,
    minScore: profile.minScore,
    seniority: profile.seniority,
  };
}

/**
 * `includes` first, regex second. Substring search is native and roughly free; the
 * boundary-aware regex is not. Across ~100 keywords and a few thousand postings that
 * ordering is the difference between an instant board and a visible stall.
 */
function matches(text: string, kw: CompiledKeyword): boolean {
  return text.includes(kw.lower) && kw.re.test(text);
}

const SENIOR_RE =
  /\b(senior|sr\.?|staff|principal|lead|director|head of|vp|vice president|chief|distinguished|manager|iii|iv)\b/i;
const ENTRY_RE =
  /\b(intern|internship|junior|jr\.?|entry[- ]level|entry|new ?grad|graduate|associate|apprentice|trainee|early[- ]career|campus|university)\b/i;

function seniorityOf(title: string): "entry" | "mid" | "senior" {
  if (ENTRY_RE.test(title)) return "entry";
  if (SENIOR_RE.test(title)) return "senior";
  return "mid";
}

/** Bands are relative to the user's own threshold, so raising `minScore` tightens every
 *  band together instead of leaving the labels stranded at fixed numbers. */
function bandOf(score: number, minScore: number): FitBand {
  const base = Math.max(1, minScore);
  if (score >= base * 3) return "strong";
  if (score >= base * 2) return "good";
  if (score >= base) return "partial";
  return "stretch";
}

const REMOTE_RE = /remote|anywhere|distributed|work from home|wfh/i;
const HYBRID_RE = /hybrid|flexible location|[2-4] days? (a week )?in( the)? office/i;

/** Empty filter means everywhere. "Remote" is matched loosely because boards spell it a
 *  dozen ways ("Remote - US", "Anywhere", "Distributed"). */
export function locationAllowed(location: string, allow: string[]): boolean {
  if (allow.length === 0) return true;
  const loc = location.toLowerCase();
  if (!loc) return true; // unstated location is not evidence of a mismatch
  return allow.some((want) => {
    if (want === "remote") return REMOTE_RE.test(loc);
    return loc.includes(want);
  });
}

/** What arrangement a posting reads as. Boards rarely have a structured field for this, so
 *  it is inferred from the location string first and the body only as a fallback. */
export function workModeOf(job: { location: string; haystack: string }): WorkMode {
  if (HYBRID_RE.test(job.location)) return "hybrid";
  if (REMOTE_RE.test(job.location)) return "remote";
  if (job.location) return "onsite";
  // No location at all: fall back to the body, where remote is usually stated explicitly.
  if (HYBRID_RE.test(job.haystack)) return "hybrid";
  if (REMOTE_RE.test(job.haystack)) return "remote";
  return "onsite";
}

/** Empty preference means any arrangement is fine. */
export function workModeAllowed(job: { location: string; haystack: string }, want: WorkMode[]): boolean {
  return want.length === 0 || want.includes(workModeOf(job));
}

/**
 * How much a posting's apparent level helps or hurts, given what the user is aiming at.
 *
 * These are nudges, not filters. Company leveling is inconsistent enough that a "Senior"
 * in a title is weak evidence, so it moves a job down the list rather than off it.
 */
const SENIORITY_ADJUST: Record<SeniorityPref, Record<"entry" | "mid" | "senior", number>> = {
  intern: { entry: 3, mid: 0, senior: -4 },
  entry: { entry: 2, mid: 0, senior: -3 },
  mid: { entry: 0, mid: 1, senior: -1 },
  senior: { entry: -2, mid: 0, senior: 2 },
  any: { entry: 0, mid: 0, senior: 0 },
};

export function scoreJob(job: Job, profile: CompiledProfile, firstSeen: string, isNew: boolean): ScoredJob {
  const title = job.title.toLowerCase();
  const body = job.haystack;

  const hits: Hit[] = [];
  let score = 0;

  for (const kw of profile.core) {
    if (matches(title, kw)) {
      hits.push({ keyword: kw.keyword, where: "title", points: 3, group: "core" });
      score += 3;
    } else if (matches(body, kw)) {
      hits.push({ keyword: kw.keyword, where: "body", points: 1, group: "core" });
      score += 1;
    }
  }

  for (const kw of profile.bonus) {
    if (matches(title, kw)) {
      hits.push({ keyword: kw.keyword, where: "title", points: 1, group: "bonus" });
      score += 1;
    } else if (matches(body, kw)) {
      hits.push({ keyword: kw.keyword, where: "body", points: 0.5, group: "bonus" });
      score += 0.5;
    }
  }

  let vetoedBy: string | null = null;
  for (const kw of profile.exclude) {
    if (matches(title, kw) || matches(body, kw)) {
      vetoedBy = kw.keyword;
      break;
    }
  }

  const seniority = seniorityOf(job.title);
  score += SENIORITY_ADJUST[profile.seniority][seniority];
  score = Math.max(0, Math.round(score * 2) / 2);

  hits.sort((a, b) => b.points - a.points || a.keyword.localeCompare(b.keyword));

  return {
    ...job,
    score,
    band: bandOf(score, profile.minScore),
    hits,
    vetoedBy,
    seniority,
    firstSeen,
    isNew,
  };
}

/** Whole days since the posting date; null when the board published no date. */
export function ageDays(job: { postedAt: string | null }): number | null {
  if (!job.postedAt) return null;
  const t = new Date(`${job.postedAt}T00:00:00`).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/**
 * Freshness bucket.
 *
 * A week is the window where applying still feels early. A month is roughly when a req
 * either has a shortlist or has quietly died, so past that a posting is a lead worth
 * checking rather than one worth rushing. Tighter thresholds than this end up marking
 * almost the whole board stale, which stops meaning anything.
 */
export function freshness(job: { postedAt: string | null }): "fresh" | "ok" | "stale" | "unknown" {
  const d = ageDays(job);
  if (d === null) return "unknown";
  if (d <= 7) return "fresh";
  if (d <= 30) return "ok";
  return "stale";
}
