/**
 * Shared types for the Jobwatch client. Everything here crosses the boundary between
 * untrusted third-party ATS payloads and our own UI, so the rule is: fields that came
 * from the network are plain strings that have already been through `sanitize.ts`.
 */

/** Applicant-tracking systems we can read without a key or a proxy (all send CORS `*`). */
export type AtsKind =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "workable"
  | "recruitee";

/** One company we poll. `token` is that company's slug on `kind`'s job board. */
export interface Source {
  /** Stable id: `${kind}:${token}`. Used for dedupe and for React keys. */
  id: string;
  kind: AtsKind;
  token: string;
  /** Display name. Defaults to the token until a fetch tells us better. */
  name: string;
  /** Which starter pack seeded this source, or "custom" if the user added it. */
  pack: string;
  enabled: boolean;
}

/** Outcome of polling a single source, kept so the UI can be honest about failures. */
export interface SourceResult {
  source: Source;
  status: "ok" | "error" | "empty";
  count: number;
  error?: string;
  ms: number;
}

/** A posting after normalization. All strings are sanitized plain text except `descHtml`. */
export interface Job {
  /** `${sourceId}:${remote id}` — stable across runs, which is what makes "new" work. */
  id: string;
  sourceId: string;
  company: string;
  title: string;
  location: string;
  /** ISO `YYYY-MM-DD`, or null when the board does not publish one. */
  postedAt: string | null;
  /** Validated http(s) apply link. Never render a link if this is null. */
  url: string | null;
  department: string | null;
  /** Sanitized HTML fragment for the detail view. Safe to inject; see sanitize.ts. */
  descHtml: string;
  /** Lowercased plain text of title + description, used only for keyword matching. */
  haystack: string;
}

/** Why a job scored what it scored. Every point is traceable to a keyword hit. */
export interface Hit {
  keyword: string;
  where: "title" | "body";
  points: number;
  group: string;
}

export type FitBand = "strong" | "good" | "partial" | "stretch";

export interface ScoredJob extends Job {
  score: number;
  band: FitBand;
  hits: Hit[];
  /** Set when an exclude keyword matched. Vetoed jobs are kept but filtered out by default. */
  vetoedBy: string | null;
  /** True when the posting looks entry-level friendly, false when it reads senior. */
  seniority: "entry" | "mid" | "senior";
  /** First time we ever saw this id, ISO timestamp. Drives the NEW badge. */
  firstSeen: string;
  isNew: boolean;
}

/** How the user wants seniority weighted. Not a filter: a senior title in a posting is
 *  often just a company's leveling habit, so this tilts the ranking rather than censoring. */
export type SeniorityPref = "intern" | "entry" | "mid" | "senior" | "any";

/** Where the user is willing to work. Empty means no preference. */
export type WorkMode = "remote" | "hybrid" | "onsite";

/**
 * The user's full profile, in two halves that mirror how a person actually thinks about a
 * job hunt: who I am, and what I am looking for.
 *
 * The matcher does not consume this directly. `compileProfile` in scoring.ts derives the
 * keyword weights from it, which keeps the settings screen in plain language (your skills,
 * the roles you want) instead of exposing scoring jargon to someone who just wants a job.
 */
export interface Profile {
  /* ---- Who you are ---- */

  /**
   * The pasted resume, plain text. This never leaves the browser and is never sent
   * anywhere: it exists only so keywords can be suggested from it and so the user can
   * re-run that suggestion later.
   *
   * Pasting it stores it, unless `rememberResume` is off. It is clearable on its own
   * without losing the rest of the setup, and is excluded from backup exports unless the
   * user explicitly ticks the box.
   */
  resume: string;
  /**
   * Whether the resume may be written to this browser's storage at all.
   *
   * Off means the text lives only in memory for this visit and is gone when the tab closes,
   * while the titles and skills pulled out of it are kept. That is the right default posture
   * on a shared, borrowed, or public machine, and making it a decision up front is better
   * than relying on someone remembering to press Erase on their way out.
   */
  rememberResume: boolean;
  /** A one-line self-description, shown nowhere but the settings screen. Purely for the
   *  user's own orientation when they come back to this in three weeks. */
  headline: string;
  /** Tools, languages, and methods the user actually has. Scored as supporting evidence. */
  skills: string[];
  /** What level the user is aiming at. */
  seniority: SeniorityPref;

  /* ---- What you are looking for ---- */

  /** The roles being targeted, e.g. "Product Designer". The highest-weighted signal. */
  targetTitles: string[];
  /** Anything else worth points that is not a title or a skill: industries, domains, teams. */
  extraKeywords: string[];
  /** Hard veto: any match pushes the job off the main board (it is kept, not deleted). */
  exclude: string[];
  /** If non-empty, the location must contain one of these (case-insensitive). */
  locations: string[];
  /** Empty means no preference. Otherwise the posting must read as one of these. */
  workModes: WorkMode[];
  /** Below this the job is off the main board by default. */
  minScore: number;
}
