/**
 * Local persistence.
 *
 * Everything Jobwatch remembers lives in this browser's localStorage and goes nowhere else.
 * That is the privacy claim the product makes, so it is worth being literal about it: there
 * is no network write path in this file, and no field here is ever sent anywhere.
 *
 * localStorage is also *untrusted input*. A stored blob can be edited by hand, corrupted by
 * a half-finished write, or left behind by an older version of the app. So every read is
 * validated and coerced back into shape; a malformed record degrades to the default rather
 * than throwing on load and bricking the page.
 */

import type { AtsKind, Profile, SeniorityPref, Source, WorkMode } from "./types";
import { isValidToken } from "./ats";

const NS = "jobwatch.v1";
const KEYS = {
  profile: `${NS}.profile`,
  sources: `${NS}.sources`,
  seen: `${NS}.seen`,
  saved: `${NS}.saved`,
  hidden: `${NS}.hidden`,
  applied: `${NS}.applied`,
  meta: `${NS}.meta`,
};

/** Safari in private mode and hardened browser profiles both throw on localStorage access.
 *  The app should still run, just without memory between visits. */
function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled. Losing persistence is acceptable; crashing is not.
  }
}

/* -------------------------------------------------------------------- lists */

function strList(value: unknown, max = 400): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const s = item.trim().slice(0, 120);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/* ------------------------------------------------------------------ profile */

const SENIORITY: SeniorityPref[] = ["intern", "entry", "mid", "senior", "any"];
const WORK_MODES: WorkMode[] = ["remote", "hybrid", "onsite"];

/** The resume is free text and can be long, but not unbounded. 200k characters is a very
 *  long CV and still small enough that the extractor stays instant. */
const MAX_RESUME = 200_000;

export function loadProfile(fallback: Profile): Profile {
  const raw = read(KEYS.profile);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const o = raw as Record<string, unknown>;

  const minScore = typeof o.minScore === "number" && Number.isFinite(o.minScore)
    ? Math.min(50, Math.max(0, Math.round(o.minScore)))
    : fallback.minScore;

  return {
    resume: typeof o.resume === "string" ? o.resume.slice(0, MAX_RESUME) : "",
    rememberResume: o.rememberResume !== false,
    headline: typeof o.headline === "string" ? o.headline.slice(0, 200) : "",
    skills: strList(o.skills),
    seniority: SENIORITY.includes(o.seniority as SeniorityPref)
      ? (o.seniority as SeniorityPref)
      : fallback.seniority,
    targetTitles: strList(o.targetTitles),
    extraKeywords: strList(o.extraKeywords),
    exclude: strList(o.exclude),
    locations: strList(o.locations, 40),
    workModes: Array.isArray(o.workModes)
      ? WORK_MODES.filter((m) => (o.workModes as unknown[]).includes(m))
      : [],
    minScore,
  };
}

/**
 * Persist the profile, honouring `rememberResume`.
 *
 * The check lives here rather than at the call sites because this is the only function that
 * can write a resume to disk. A component that forgets the flag cannot leak past it.
 */
export const saveProfile = (p: Profile): void =>
  write(KEYS.profile, p.rememberResume ? p : { ...p, resume: "" });

/** Erase the resume alone, without touching the keywords derived from it. Someone on a
 *  shared or borrowed machine should be able to drop the sensitive part and keep the setup. */
export function clearResume(profile: Profile): Profile {
  const next = { ...profile, resume: "" };
  saveProfile(next);
  return next;
}

/* ------------------------------------------------------------------ sources */

const VALID_KINDS = new Set<AtsKind>([
  "greenhouse", "lever", "ashby", "smartrecruiters", "workable", "recruitee",
]);

/** Sources are re-validated on load because the token is interpolated into a request URL.
 *  A tampered store must not be able to point a fetch at a host of its choosing. */
export function loadSources(): Source[] | null {
  const raw = read(KEYS.sources);
  if (!Array.isArray(raw)) return null;
  const out: Source[] = [];
  for (const item of raw.slice(0, 1000)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const kind = o.kind as AtsKind;
    const token = typeof o.token === "string" ? o.token : "";
    if (!VALID_KINDS.has(kind) || !isValidToken(token)) continue;
    out.push({
      id: `${kind}:${token}`,
      kind,
      token,
      name: typeof o.name === "string" ? o.name.slice(0, 120) : token,
      pack: typeof o.pack === "string" ? o.pack.slice(0, 40) : "custom",
      enabled: o.enabled === true,
    });
  }
  return out;
}

export const saveSources = (s: Source[]): void => write(KEYS.sources, s);

/* ------------------------------------------- seen ledger and per-job flags */

/** `job id -> ISO date first observed`. This is the only reason "new since last run" can
 *  work without a server: the browser is the one that remembers. */
export type SeenMap = Record<string, string>;

/** Bounded so a long-running install cannot grow the store without limit. Oldest entries
 *  are dropped first, which at worst re-flags a very old posting as new. */
const MAX_SEEN = 40_000;

export function loadSeen(): SeenMap {
  return coerceSeen(read(KEYS.seen));
}

function coerceSeen(raw: unknown): SeenMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return Object.create(null);
  // Null-prototype: this map is keyed by ids that ultimately came off the network, so a
  // `__proto__` or `constructor` key must land as an ordinary entry rather than reaching
  // Object.prototype. Assigning a string to `__proto__` on a normal literal is silently
  // dropped, which would also quietly lose a real job's history.
  const out: SeenMap = Object.create(null);
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "string" || k.length >= 300) continue;
    out[k] = v;
    // The cap has to hold on the way in as well as on the way out. `saveSeen` bounds what
    // this app writes, but the store can also be hand-edited or restored from a backup, and
    // a ledger with millions of entries would be read on every single page load.
    if (++n >= MAX_SEEN) break;
  }
  return out;
}

export function saveSeen(seen: SeenMap): void {
  const entries = Object.entries(seen);
  if (entries.length > MAX_SEEN) {
    entries.sort((a, b) => (a[1] < b[1] ? 1 : -1));
    write(KEYS.seen, Object.fromEntries(entries.slice(0, MAX_SEEN)));
    return;
  }
  write(KEYS.seen, seen);
}

function loadIdSet(key: string): Set<string> {
  const raw = read(key);
  return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 20_000) : []);
}

export const loadSaved = (): Set<string> => loadIdSet(KEYS.saved);
export const loadHidden = (): Set<string> => loadIdSet(KEYS.hidden);
export const loadApplied = (): Set<string> => loadIdSet(KEYS.applied);
export const persistSaved = (s: Set<string>): void => write(KEYS.saved, [...s]);
export const persistHidden = (s: Set<string>): void => write(KEYS.hidden, [...s]);
export const persistApplied = (s: Set<string>): void => write(KEYS.applied, [...s]);

/* --------------------------------------------------------------------- meta */

export interface Meta {
  lastRun: string | null;
  onboarded: boolean;
  theme: "light" | "dark" | "system";
}

const DEFAULT_META: Meta = { lastRun: null, onboarded: false, theme: "system" };

export function loadMeta(): Meta {
  const raw = read(KEYS.meta);
  if (!raw || typeof raw !== "object") return DEFAULT_META;
  const o = raw as Record<string, unknown>;
  const theme = o.theme === "light" || o.theme === "dark" || o.theme === "system" ? o.theme : "system";
  return {
    lastRun: typeof o.lastRun === "string" ? o.lastRun : null,
    onboarded: o.onboarded === true,
    theme,
  };
}

export const saveMeta = (m: Meta): void => write(KEYS.meta, m);

/* ------------------------------------------------------------ export/import */

/**
 * The escape hatch. Because everything is local, "back up my setup" and "move to my laptop"
 * have to be a file the user holds, or the data is effectively hostage.
 *
 * `includeResume` defaults to false. An export is a file that gets emailed, dropped in a
 * shared folder, or synced to a cloud drive, and a resume is the one thing here that is
 * genuinely personal. Including it has to be a decision, not a default.
 */
export function exportAll(includeResume = false): string {
  const profile = read(KEYS.profile);
  const safeProfile =
    profile && typeof profile === "object" && !includeResume
      ? { ...(profile as Record<string, unknown>), resume: "" }
      : profile;

  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      resumeIncluded: includeResume,
      profile: safeProfile,
      sources: read(KEYS.sources),
      seen: read(KEYS.seen),
      saved: read(KEYS.saved),
      hidden: read(KEYS.hidden),
      applied: read(KEYS.applied),
      meta: read(KEYS.meta),
    },
    null,
    2,
  );
}

/** A backup that is larger than this is not a backup of this app. */
const MAX_IMPORT_CHARS = 16 * 1024 * 1024;

/**
 * Imported files are foreign data: a friend's file, an old export, or something a person
 * was talked into downloading. Every field still goes through the read validators, but the
 * shape and the size are checked *before* the blob lands in localStorage.
 *
 * The reason is the reload. Import writes and then reloads the page, so anything that
 * survives into the store is re-read on every subsequent visit. A store that only fails on
 * the way out would leave a non-technical user with a page they cannot fix from inside the
 * app, because the settings screen they would need is behind the same load.
 */
export function importAll(json: string): boolean {
  if (typeof json !== "string" || json.length > MAX_IMPORT_CHARS) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const o = parsed as Record<string, unknown>;

  const isRecord = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  const idList = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20_000) : null;

  let recognized = false;
  const put = (key: string, value: unknown) => {
    if (value === null) return;
    write(key, value);
    recognized = true;
  };

  put(KEYS.profile, isRecord(o.profile) ? o.profile : null);
  put(KEYS.sources, Array.isArray(o.sources) ? o.sources.slice(0, 1000) : null);
  put(KEYS.seen, isRecord(o.seen) ? coerceSeen(o.seen) : null);
  put(KEYS.saved, idList(o.saved));
  put(KEYS.hidden, idList(o.hidden));
  put(KEYS.applied, idList(o.applied));
  put(KEYS.meta, isRecord(o.meta) ? o.meta : null);

  // Nothing recognizable means this was some other JSON file, and telling the user so is
  // better than reloading into an unchanged app and looking broken.
  return recognized;
}

export function clearAll(): void {
  for (const key of Object.values(KEYS)) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing we can do, and nothing that should stop the reset */
    }
  }
}
